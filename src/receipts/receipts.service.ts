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
      products: {
        select: { name: true, sku: true },
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
        return this.toReceipt(transaction);
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

  private toReceipt(transaction: ReceiptRecord) {
    const payment =
      transaction.payments.find((candidate) => candidate.status === 'PAID') ??
      transaction.payments[0];
    const change =
      payment?.method === 'CASH' &&
      payment.status === 'PAID' &&
      payment.amount >= transaction.total
        ? this.money(payment.amount - transaction.total)
        : null;

    return {
      transaction_id: transaction.id,
      client_transaction_id: transaction.client_transaction_id,
      status: transaction.status,
      created_at: transaction.created_at,
      store: transaction.tenants,
      outlet: transaction.outlets,
      cashier: transaction.users,
      customer: transaction.customers,
      items: transaction.transaction_items.map((item) => ({
        item_id: item.id,
        product_id: item.product_id,
        product_name: item.products.name,
        sku: item.products.sku,
        quantity: item.quantity,
        unit_price: this.money(item.unit_price),
        subtotal: this.money(item.subtotal),
      })),
      payment: payment
        ? {
            id: payment.id,
            method: payment.method,
            status: payment.status,
            amount: this.money(payment.amount),
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
