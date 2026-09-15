import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionsService } from '../transactions/transactions.service';
import { SyncTransactionsDto } from './dto/sync-transactions.dto';

type ErrorBody = {
  error_code?: unknown;
  message?: unknown;
};

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async transactions(user: JwtPayload, input: SyncTransactionsDto) {
    const dto = await this.validDto(input);
    await this.validateSyncAccess(user, dto);

    const results: Array<Record<string, unknown>> = [];
    let synced = 0;

    // Process in request order. Each call owns its existing atomic checkout,
    // while one failed offline record does not prevent later records syncing.
    for (const transaction of dto.transactions) {
      try {
        const result = await this.transactionsService.create(user, transaction);
        results.push({
          client_transaction_id: transaction.client_transaction_id,
          status: 'SYNCED',
          transaction: result,
        });
        synced++;
      } catch (error) {
        if (!(error instanceof HttpException)) {
          throw error;
        }
        results.push({
          client_transaction_id: transaction.client_transaction_id,
          status: 'FAILED',
          error: this.errorResponse(error),
        });
      }
    }

    return {
      total: results.length,
      synced,
      failed: results.length - synced,
      results,
    };
  }

  private async validateSyncAccess(
    user: JwtPayload,
    dto: SyncTransactionsDto,
  ): Promise<void> {
    if (!user || !isUUID(user.sub) || !isUUID(user.tenant_id)) {
      throw new UnauthorizedException('Invalid user context');
    }
    const tenantId = user.tenant_id.toLowerCase();
    const userId = user.sub.toLowerCase();

    await this.prisma.$transaction(
      async (tx) => {
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
          throw new ForbiddenException('Role cannot sync transactions');
        }
        if (actor.role !== 'CASHIER') {
          return;
        }
        if (!actor.outlet_id) {
          throw this.shiftRequired();
        }

        const shift = await tx.cashier_sessions.findFirst({
          where: {
            tenant_id: tenantId,
            user_id: userId,
            status: 'OPEN',
          },
          select: { outlet_id: true },
        });
        if (!shift) {
          throw this.shiftRequired();
        }

        const requestedOutlets = new Set(
          dto.transactions.map((transaction) =>
            transaction.outlet_id.toLowerCase(),
          ),
        );
        if (
          requestedOutlets.size !== 1 ||
          !requestedOutlets.has(actor.outlet_id) ||
          shift.outlet_id !== actor.outlet_id
        ) {
          throw new ForbiddenException({
            message: 'Sync outlet does not match the cashier open shift',
            error_code: 'SHIFT_OUTLET_MISMATCH',
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async validDto(input: SyncTransactionsDto) {
    const dto = plainToInstance(SyncTransactionsDto, input);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length) {
      throw new BadRequestException({
        message: 'Invalid transaction sync input',
        error_code: 'INVALID_INPUT',
      });
    }
    return dto;
  }

  private shiftRequired() {
    return new ForbiddenException({
      message: 'Cashier must have an open shift before syncing transactions',
      error_code: 'OPEN_SHIFT_REQUIRED',
    });
  }

  private errorResponse(error: HttpException) {
    const response = error.getResponse();
    const body: ErrorBody =
      typeof response === 'object' && response !== null
        ? (response as ErrorBody)
        : {};
    const rawMessage = body.message ?? response;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : error.message;

    return {
      status_code: error.getStatus(),
      error_code:
        typeof body.error_code === 'string'
          ? body.error_code
          : 'TRANSACTION_SYNC_FAILED',
      message,
    };
  }
}
