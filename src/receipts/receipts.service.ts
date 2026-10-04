import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';

const receiptSelect = {
  id: true,
  client_transaction_id: true,
  status: true,
  subtotal: true,
  discount: true,
  tax: true,
  total: true,
  created_at: true,
  tenants: {
    select: { id: true, name: true, address: true },
  },
  outlets: {
    select: { id: true, name: true, address: true },
  },
  users: {
    select: { id: true, name: true },
  },
  customers: {
    select: { id: true, name: true, phone: true, email: true },
  },
  transaction_items: {
    select: {
      id: true,
      product_id: true,
      quantity: true,
      unit_price: true,
      subtotal: true,
      product_name_snapshot: true,
      sku_snapshot: true,
      base_price_snapshot: true,
      effective_price_snapshot: true,
      note_snapshot: true,
      transaction_item_modifiers: {
        select: {
          id: true,
          modifier_group_id: true,
          modifier_option_id: true,
          group_name_snapshot: true,
          option_name_snapshot: true,
          price_delta_snapshot: true,
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  },
  payments: {
    select: {
      id: true,
      method: true,
      status: true,
      amount: true,
      amount_received: true,
      change_amount: true,
      provider: true,
      provider_reference: true,
      paid_at: true,
    },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.transactionsSelect;

type ReceiptRecord = Prisma.transactionsGetPayload<{
  select: typeof receiptSelect;
}>;

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  findOne(user: JwtPayload, transactionId: string) {
    if (!isUUID(transactionId)) {
      throw new BadRequestException('Invalid transaction ID');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.receiptScope(tx, user);
        const transaction = await tx.transactions.findFirst({
          where: {
            id: transactionId.toLowerCase(),
            tenant_id: scope.tenantId,
            ...(scope.outletId ? { outlet_id: scope.outletId } : {}),
          },
          select: receiptSelect,
        });
        if (!transaction) {
          throw new NotFoundException('Receipt not found');
        }
        const legacyProductIds = [...new Set(
          transaction.transaction_items
            .filter((item) => item.product_name_snapshot === null)
            .map((item) => item.product_id),
        )];
        const legacyProducts = legacyProductIds.length
          ? await tx.products.findMany({
              where: {
                tenant_id: scope.tenantId,
                id: { in: legacyProductIds },
              },
              select: { id: true, name: true, sku: true },
            })
          : [];
        return this.toReceipt(
          transaction,
          new Map(legacyProducts.map((product) => [product.id, product])),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async receiptScope(
    tx: Prisma.TransactionClient,
    user: JwtPayload,
  ): Promise<{ tenantId: string; outletId?: string }> {
    if (!user || !isUUID(user.sub) || !isUUID(user.tenant_id)) {
      throw new UnauthorizedException('Invalid user context');
    }

    const tenantId = user.tenant_id.toLowerCase();
    const actor = await tx.users.findFirst({
      where: {
        id: user.sub.toLowerCase(),
        tenant_id: tenantId,
        is_active: true,
        tenants: { is_active: true },
      },
      select: { role: true, outlet_id: true },
    });
    if (!actor) {
      throw new UnauthorizedException('User or tenant is inactive');
    }
    if (!['OWNER', 'ADMIN', 'CASHIER'].includes(actor.role)) {
      throw new ForbiddenException('Role cannot view receipts');
    }
    if (actor.role === 'CASHIER') {
      if (!actor.outlet_id) {
        throw new ForbiddenException('Outlet access denied');
      }
      return { tenantId, outletId: actor.outlet_id };
    }
    return { tenantId };
  }

  private toReceipt(
    transaction: ReceiptRecord,
    legacyProducts: Map<string, { id: string; name: string; sku: string }>,
  ) {
    const payment =
      transaction.payments.find((candidate) => candidate.status === 'PAID') ??
      transaction.payments[0];
    let change: number | null = null;
    if (payment?.method === 'CASH' && payment.status === 'PAID') {
      if (payment.change_amount != null) {
        change = this.money(payment.change_amount);
      } else if (payment.amount_received == null && payment.amount >= transaction.total) {
        // Historical RC2 rows stored tender in amount; preserve baseline behavior.
        change = this.money(payment.amount - transaction.total);
      }
    }

    return {
      transaction_id: transaction.id,
      client_transaction_id: transaction.client_transaction_id,
      status: transaction.status,
      created_at: transaction.created_at,
      store: transaction.tenants,
      outlet: transaction.outlets,
      cashier: transaction.users,
      customer: transaction.customers,
      items: transaction.transaction_items.map((item) => {
        // A name snapshot identifies a V1 line. For those lines every snapshot,
        // including a deliberately null SKU, is authoritative. Only legacy rows
        // without a product snapshot may use the bounded product relation.
        const isV1Snapshot = item.product_name_snapshot !== null;
        const legacyProduct = legacyProducts.get(item.product_id);
        const basePrice = isV1Snapshot
          ? item.base_price_snapshot
          : item.unit_price;
        const effectivePrice = isV1Snapshot
          ? item.effective_price_snapshot
          : item.unit_price;
        return {
          item_id: item.id,
          product_id: item.product_id,
          product_name: isV1Snapshot
            ? item.product_name_snapshot
            : legacyProduct?.name ?? null,
          sku: isV1Snapshot ? item.sku_snapshot : legacyProduct?.sku ?? null,
          quantity: item.quantity,
          base_price: basePrice != null ? this.money(basePrice) : null,
          effective_price: effectivePrice != null
            ? this.money(effectivePrice)
            : null,
          // unit_price remains the established receipt field and is already the
          // effective price; modifier deltas are informational only.
          unit_price: this.money(item.unit_price),
          subtotal: this.money(item.subtotal),
          note: item.note_snapshot,
          modifiers: item.transaction_item_modifiers.map((modifier) => ({
            id: modifier.id,
            modifier_group_id: modifier.modifier_group_id,
            modifier_option_id: modifier.modifier_option_id,
            group_name: modifier.group_name_snapshot,
            option_name: modifier.option_name_snapshot,
            price_delta: modifier.price_delta_snapshot,
          })),
        };
      }),
      payment: payment
        ? {
            id: payment.id,
            method: payment.method,
            status: payment.status,
            amount: this.money(payment.amount),
            amount_received: payment.amount_received != null
              ? this.money(payment.amount_received)
              : null,
            change_amount: payment.change_amount != null
              ? this.money(payment.change_amount)
              : null,
            provider: payment.provider,
            provider_reference: payment.provider_reference,
            paid_at: payment.paid_at,
          }
        : null,
      totals: {
        subtotal: this.money(transaction.subtotal),
        discount: this.money(transaction.discount),
        tax: this.money(transaction.tax),
        total: this.money(transaction.total),
      },
      change,
    };
  }

  private money(value: bigint): number {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new InternalServerErrorException(
        'Receipt value exceeds supported integer range',
      );
    }
    return Number(value);
  }
}
