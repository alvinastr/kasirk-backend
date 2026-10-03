import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { CloseShiftDto } from './dto/close-shift.dto';
import { OpenShiftDto } from './dto/open-shift.dto';

const shiftSelect = {
  id: true,
  outlet_id: true,
  user_id: true,
  opening_cash: true,
  closing_cash: true,
  expected_cash: true,
  difference: true,
  status: true,
  opened_at: true,
  closed_at: true,
  outlets: { select: { id: true, name: true } },
  users: { select: { id: true, name: true } },
} satisfies Prisma.cashier_sessionsSelect;

type ShiftRecord = Prisma.cashier_sessionsGetPayload<{
  select: typeof shiftSelect;
}>;

type ActorContext = {
  tenantId: string;
  userId: string;
  role: string;
  outletId: string | null;
};

const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

@Injectable()
export class ShiftsService {
  constructor(private readonly prisma: PrismaService) {}

  async open(user: JwtPayload, input: OpenShiftDto) {
    const dto = await this.validDto(OpenShiftDto, input);
    const outletId = dto.outlet_id.toLowerCase();

    return this.serializableWrite(async (tx) => {
      const actor = await this.actorContext(tx, user);
      if (
        actor.role === 'CASHIER' &&
        (!actor.outletId || actor.outletId !== outletId)
      ) {
        throw new ForbiddenException({
          message: 'Outlet access denied',
          error_code: 'OUTLET_ACCESS_DENIED',
        });
      }

      const outlet = await tx.outlets.findFirst({
        where: { id: outletId, tenant_id: actor.tenantId, is_active: true },
        select: { id: true },
      });
      if (!outlet) {
        throw new NotFoundException('Outlet not found');
      }

      const activeShift = await tx.cashier_sessions.findFirst({
        where: {
          tenant_id: actor.tenantId,
          user_id: actor.userId,
          status: 'OPEN',
        },
        select: { id: true },
      });
      if (activeShift) {
        throw this.alreadyOpen();
      }

      const shift = await tx.cashier_sessions.create({
        data: {
          tenant_id: actor.tenantId,
          outlet_id: outletId,
          user_id: actor.userId,
          opening_cash: null,
          status: 'OPEN',
        },
        select: shiftSelect,
      });
      return this.toResponse(shift);
    }, true);
  }

  current(user: JwtPayload) {
    return this.prisma.$transaction(
      async (tx) => {
        const actor = await this.actorContext(tx, user);
        const shift = await tx.cashier_sessions.findFirst({
          where: {
            tenant_id: actor.tenantId,
            user_id: actor.userId,
            status: 'OPEN',
          },
          select: shiftSelect,
          orderBy: { opened_at: 'desc' },
        });
        if (!shift) {
          throw new NotFoundException('Open shift not found');
        }
        return this.toResponse(shift);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async close(user: JwtPayload, id: string, input: CloseShiftDto) {
    if (!isUUID(id)) {
      throw new BadRequestException('Invalid shift ID');
    }
    const shiftId = id.toLowerCase();
    await this.validDto(CloseShiftDto, input);

    return this.serializableWrite(async (tx) => {
      const actor = await this.actorContext(tx, user);
      const shift = await tx.cashier_sessions.findFirst({
        where: { id: shiftId, tenant_id: actor.tenantId },
        select: shiftSelect,
      });
      if (!shift) {
        throw new NotFoundException('Shift not found');
      }
      if (actor.role === 'CASHIER' && shift.user_id !== actor.userId) {
        throw new ForbiddenException({
          message: 'Cashier can only close their own shift',
          error_code: 'SHIFT_ACCESS_DENIED',
        });
      }
      if (shift.status !== 'OPEN') {
        throw new ConflictException({
          message: 'Shift is already closed',
          error_code: 'SHIFT_ALREADY_CLOSED',
        });
      }

      // V1-M6 contract: the server derives the final operational summary
      // inside the same atomic transaction, from explicitly linked
      // COMPLETED transactions, before the state transition. The summary is
      // returned by GET /shifts/:id/summary; this close response keeps the
      // frozen shift response shape (no reconciliation values).
      await this.deriveSummary(tx, actor.tenantId, shift);

      const closedAt = new Date();
      const updated = await tx.cashier_sessions.updateMany({
        where: {
          id: shift.id,
          tenant_id: actor.tenantId,
          status: 'OPEN',
        },
        data: {
          status: 'CLOSED',
          closing_cash: null,
          expected_cash: null,
          difference: null,
          closed_at: closedAt,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          message: 'Shift was already closed',
          error_code: 'SHIFT_ALREADY_CLOSED',
        });
      }

      const closedShift = await tx.cashier_sessions.findFirst({
        where: { id: shift.id, tenant_id: actor.tenantId },
        select: shiftSelect,
      });
      if (!closedShift) {
        throw new InternalServerErrorException('Unable to read closed shift');
      }
      return this.toResponse(closedShift);
    });
  }

  async summary(user: JwtPayload, id: string) {
    if (!isUUID(id)) throw new BadRequestException('Invalid shift ID');
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.actorContext(tx, user);
      const shift = await tx.cashier_sessions.findFirst({
        where: { id: id.toLowerCase(), tenant_id: actor.tenantId },
        select: shiftSelect,
      });
      if (!shift) throw new NotFoundException({ message: 'Shift not found', error_code: 'SHIFT_NOT_FOUND' });
      if (actor.role === 'CASHIER' && shift.user_id !== actor.userId) {
        throw new ForbiddenException({ message: 'Shift access denied', error_code: 'SHIFT_ACCESS_DENIED' });
      }
      return this.deriveSummary(tx, actor.tenantId, shift);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async deriveSummary(tx: Prisma.TransactionClient, tenantId: string, shift: ShiftRecord) {
    const where = { tenant_id: tenantId, cashier_session_id: shift.id, status: 'COMPLETED' };
    const totals = await tx.transactions.aggregate({ where, _sum: { total: true }, _count: { _all: true } });
    const sales = await tx.transactions.findMany({
      where,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: {
        payments: { where: { tenant_id: tenantId, status: 'PAID' }, select: { method: true, amount: true } },
        transaction_items: {
          where: { tenant_id: tenantId }, orderBy: { id: 'asc' },
          select: { product_id: true, product_name_snapshot: true, quantity: true, products: { select: { name: true } } },
        },
      },
    });
    let cash = 0n;
    let qris = 0n;
    const products = new Map<string, { product_id: string; product_name: string; quantity: number }>();
    for (const sale of sales) {
      for (const payment of sale.payments) {
        if (payment.method === 'CASH') cash += payment.amount;
        if (payment.method === 'QRIS') qris += payment.amount;
      }
      for (const item of sale.transaction_items) {
        const name = item.product_name_snapshot ?? item.products?.name ?? 'Unknown product';
        const existing = products.get(item.product_id);
        if (existing) {
          existing.quantity += item.quantity;
          if (existing.product_name === 'Unknown product' && name !== 'Unknown product') {
            existing.product_name = name;
          }
        } else {
          products.set(item.product_id, { product_id: item.product_id, product_name: name, quantity: item.quantity });
        }
      }
    }
    return {
      shift_id: shift.id, status: shift.status, outlet: shift.outlets, cashier: shift.users,
      opened_at: shift.opened_at, closed_at: shift.closed_at, generated_at: new Date(),
      transaction_count: totals._count._all,
      totals: { sales: this.optionalMoney(totals._sum.total ?? 0n), cash: this.optionalMoney(cash), qris: this.optionalMoney(qris) },
      products: [...products.values()],
    };
  }

  private async actorContext(
    tx: Prisma.TransactionClient,
    user: JwtPayload,
  ): Promise<ActorContext> {
    if (!user || !isUUID(user.sub) || !isUUID(user.tenant_id)) {
      throw new UnauthorizedException('Invalid user context');
    }
    const tenantId = user.tenant_id.toLowerCase();
    const userId = user.sub.toLowerCase();
    const actor = await tx.users.findFirst({
      where: {
        id: userId,
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
      throw new ForbiddenException('Role cannot manage shifts');
    }
    return {
      tenantId,
      userId,
      role: actor.role,
      outletId: actor.outlet_id,
    };
  }

  private async validDto<T extends object>(
    dtoClass: new () => T,
    input: T,
  ): Promise<T> {
    const dto = plainToInstance(dtoClass, input);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: false,
    });
    if (errors.length) {
      throw new BadRequestException({
        message: 'Invalid shift input',
        error_code: 'INVALID_INPUT',
      });
    }
    return dto;
  }

  private async serializableWrite<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    opening = false,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(callback, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (error instanceof HttpException) {
          throw error;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (opening && error.code === 'P2002') {
            throw this.alreadyOpen();
          }
          if (error.code === 'P2034') {
            if (attempt < 2) {
              continue;
            }
            throw new ServiceUnavailableException({
              message: 'Shift changed concurrently; please retry',
              error_code: 'SHIFT_RETRY_REQUIRED',
            });
          }
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException('Unable to update shift');
  }

  private alreadyOpen() {
    return new ConflictException({
      message: 'User already has an open shift',
      error_code: 'SHIFT_ALREADY_OPEN',
    });
  }

  private assertSafeMoney(value: bigint): void {
    if (value < MIN_SAFE_INTEGER || value > MAX_SAFE_INTEGER) {
      throw new InternalServerErrorException(
        'Shift cash value exceeds supported integer range',
      );
    }
  }

  private toResponse(shift: ShiftRecord) {
    const legacy =
      shift.opening_cash !== null ||
      shift.closing_cash !== null ||
      shift.expected_cash !== null ||
      shift.difference !== null;
    return {
      shift_id: shift.id,
      outlet_id: shift.outlet_id,
      user_id: shift.user_id,
      opening_cash: this.optionalMoney(shift.opening_cash),
      closing_cash: this.optionalMoney(shift.closing_cash),
      expected_cash: this.optionalMoney(shift.expected_cash),
      difference: this.optionalMoney(shift.difference),
      status: shift.status,
      opened_at: shift.opened_at,
      closed_at: shift.closed_at,
      reconciliation_mode: legacy ? 'LEGACY' : 'NONE',
    };
  }

  private optionalMoney(value: bigint | null): number | null {
    if (value === null) {
      return null;
    }
    this.assertSafeMoney(value);
    return Number(value);
  }
}
