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

const MAX_BIGINT = 9_223_372_036_854_775_807n;
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
          opening_cash: BigInt(dto.opening_cash),
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
    const dto = await this.validDto(CloseShiftDto, input);

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

      const closedAt = new Date();
      const cashSales = await tx.transactions.aggregate({
        where: {
          tenant_id: actor.tenantId,
          outlet_id: shift.outlet_id,
          user_id: shift.user_id,
          status: 'COMPLETED',
          payments: {
            some: {
              tenant_id: actor.tenantId,
              method: 'CASH',
              status: 'PAID',
              paid_at: { gte: shift.opened_at, lte: closedAt },
            },
          },
        },
        _sum: { total: true },
      });
      const expectedCash = shift.opening_cash + (cashSales._sum.total ?? 0n);
      const closingCash = BigInt(dto.closing_cash);
      const difference = closingCash - expectedCash;
      this.assertDatabaseMoney(expectedCash);
      this.assertSafeMoney(expectedCash);
      this.assertSafeMoney(difference);

      const updated = await tx.cashier_sessions.updateMany({
        where: {
          id: shift.id,
          tenant_id: actor.tenantId,
          status: 'OPEN',
        },
        data: {
          status: 'CLOSED',
          closing_cash: closingCash,
          expected_cash: expectedCash,
          difference,
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

  private assertDatabaseMoney(value: bigint): void {
    if (value < 0n || value > MAX_BIGINT) {
      throw new InternalServerErrorException(
        'Shift cash value exceeds database integer range',
      );
    }
  }

  private assertSafeMoney(value: bigint): void {
    if (value < MIN_SAFE_INTEGER || value > MAX_SAFE_INTEGER) {
      throw new InternalServerErrorException(
        'Shift cash value exceeds supported integer range',
      );
    }
  }

  private toResponse(shift: ShiftRecord) {
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
