import {
  BadRequestException,
  ConflictException,
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
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const customerSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.customersSelect;

const completedTransactionSelect = {
  id: true,
  outlet_id: true,
  user_id: true,
  subtotal: true,
  discount: true,
  tax: true,
  total: true,
  created_at: true,
} satisfies Prisma.transactionsSelect;

type CustomerWriteData = {
  name?: string;
  phone?: string | null;
  email?: string | null;
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(user: JwtPayload) {
    return this.prisma.$transaction(
      async (tx) => {
        const tenantId = await this.tenantContext(tx, user, [
          'OWNER',
          'ADMIN',
          'CASHIER',
        ]);
        return tx.customers.findMany({
          where: { tenant_id: tenantId },
          select: customerSelect,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  create(user: JwtPayload, dto: CreateCustomerDto) {
    const data = this.createData(dto);

    return this.customerWrite(async (tx) => {
      const tenantId = await this.tenantContext(tx, user, ['OWNER', 'ADMIN']);
      return tx.customers.create({
        data: { tenant_id: tenantId, ...data },
        select: customerSelect,
      });
    });
  }

  findOne(user: JwtPayload, id: string) {
    const customerId = this.customerId(id);

    return this.prisma.$transaction(
      async (tx) => {
        const tenantId = await this.tenantContext(tx, user, [
          'OWNER',
          'ADMIN',
          'CASHIER',
        ]);
        return this.findCustomer(tx, tenantId, customerId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  update(user: JwtPayload, id: string, dto: UpdateCustomerDto) {
    const customerId = this.customerId(id);
    const data = this.updateData(dto);

    return this.customerWrite(async (tx) => {
      const tenantId = await this.tenantContext(tx, user, ['OWNER', 'ADMIN']);
      await this.findCustomer(tx, tenantId, customerId);
      return tx.customers.update({
        where: { id_tenant_id: { id: customerId, tenant_id: tenantId } },
        data,
        select: customerSelect,
      });
    });
  }

  remove(user: JwtPayload, id: string) {
    const customerId = this.customerId(id);

    return this.customerWrite(async (tx) => {
      const tenantId = await this.tenantContext(tx, user, ['OWNER', 'ADMIN']);
      await this.findCustomer(tx, tenantId, customerId);
      return tx.customers.delete({
        where: { id_tenant_id: { id: customerId, tenant_id: tenantId } },
        select: customerSelect,
      });
    }, true);
  }

  transactionHistory(user: JwtPayload, id: string) {
    const customerId = this.customerId(id);

    return this.prisma.$transaction(
      async (tx) => {
        const tenantId = await this.tenantContext(tx, user, ['OWNER', 'ADMIN']);
        await this.findCustomer(tx, tenantId, customerId);
        const where: Prisma.transactionsWhereInput = {
          tenant_id: tenantId,
          customer_id: customerId,
          status: 'COMPLETED',
        };
        const aggregate = await tx.transactions.aggregate({
          where,
          _count: { _all: true },
          _sum: { total: true },
        });
        const transactions = await tx.transactions.findMany({
          where,
          select: completedTransactionSelect,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });

        return {
          customer_id: customerId,
          transactions: transactions.map((transaction) => ({
            transaction_id: transaction.id,
            outlet_id: transaction.outlet_id,
            user_id: transaction.user_id,
            subtotal: this.money(transaction.subtotal),
            discount: this.money(transaction.discount),
            tax: this.money(transaction.tax),
            total: this.money(transaction.total),
            created_at: transaction.created_at,
          })),
          total_transactions: aggregate._count._all,
          total_spending: this.money(aggregate._sum.total ?? 0n),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async tenantContext(
    tx: Prisma.TransactionClient,
    user: JwtPayload,
    allowedRoles: string[],
  ): Promise<string> {
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
      select: { role: true },
    });
    if (!actor) {
      throw new UnauthorizedException('User or tenant is inactive');
    }
    if (!allowedRoles.includes(actor.role)) {
      throw new ForbiddenException('Role cannot perform this customer action');
    }
    return tenantId;
  }

  private async findCustomer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    customerId: string,
  ) {
    const customer = await tx.customers.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: customerSelect,
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private createData(
    dto: CreateCustomerDto,
  ): Required<Pick<CustomerWriteData, 'name'>> & CustomerWriteData {
    return {
      name: this.requiredText(dto.name, 'name'),
      phone: this.optionalText(dto.phone, 'phone'),
      email: this.optionalText(dto.email, 'email')?.toLowerCase(),
    };
  }

  private updateData(dto: UpdateCustomerDto): CustomerWriteData {
    const data: CustomerWriteData = {};
    if (dto.name !== undefined) {
      data.name = this.requiredText(dto.name, 'name');
    }
    if (dto.phone !== undefined) {
      data.phone = this.optionalText(dto.phone, 'phone');
    }
    if (dto.email !== undefined) {
      data.email = this.optionalText(dto.email, 'email')?.toLowerCase() ?? null;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one customer field is required');
    }
    return data;
  }

  private requiredText(value: string, field: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} cannot be blank`);
    }
    return normalized;
  }

  private optionalText(
    value: string | null | undefined,
    field: string,
  ): string | null {
    if (value == null) {
      return null;
    }
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(`${field} cannot be blank`);
    }
    return normalized;
  }

  private customerId(id: string): string {
    if (!isUUID(id)) {
      throw new BadRequestException('Invalid customer ID');
    }
    return id.toLowerCase();
  }

  private async customerWrite<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    deleting = false,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException({
            message: 'Phone already belongs to another customer',
            error_code: 'CUSTOMER_PHONE_EXISTS',
          });
        }
        if (deleting && error.code === 'P2003') {
          throw new ConflictException({
            message: 'Customer has transaction history and cannot be deleted',
            error_code: 'CUSTOMER_HAS_TRANSACTIONS',
          });
        }
      }
      throw error;
    }
  }

  private money(value: bigint): number {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new InternalServerErrorException(
        'Customer history value exceeds supported integer range',
      );
    }
    return Number(value);
  }
}
