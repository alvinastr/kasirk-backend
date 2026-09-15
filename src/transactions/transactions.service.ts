import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { PaymentMethod, PaymentStatus, TransactionStatus } from './types/transaction.types';

const summarySelect = {
    id: true,
    client_transaction_id: true,
    outlet_id: true,
    user_id: true,
    customer_id: true,
    status: true,
    subtotal: true,
    discount: true,
    tax: true,
    total: true,
    created_at: true,
} satisfies Prisma.transactionsSelect;

const responseSelect = {
    ...summarySelect,
    transaction_items: {
        select: { id: true, product_id: true, quantity: true, unit_price: true, subtotal: true },
        orderBy: { product_id: 'asc' },
    },
    payments: {
        select: { id: true, method: true, status: true, amount: true, paid_at: true },
        orderBy: { created_at: 'asc' },
    },
} satisfies Prisma.transactionsSelect;

type TransactionSummary = Prisma.transactionsGetPayload<{ select: typeof summarySelect }>;
type TransactionRecord = Prisma.transactionsGetPayload<{ select: typeof responseSelect }>;

@Injectable()
export class TransactionsService {
    private readonly logger = new Logger(TransactionsService.name);

    constructor(private readonly prisma: PrismaService) {}

    async create(user: JwtPayload, input: CreateTransactionDto) {
        if (!user || !isUUID(user.sub) || !isUUID(user.tenant_id)) {
            throw new UnauthorizedException('Invalid user context');
        }
        // Keep validation for callers that invoke the service outside HTTP.
        const dto = plainToInstance(CreateTransactionDto, input);
        if (!dto || (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) {
            throw new BadRequestException({ message: 'Invalid transaction input', error_code: 'INVALID_INPUT' });
        }
        if (dto.payment.method !== PaymentMethod.CASH) {
            throw new BadRequestException({ message: 'Only CASH is available', error_code: 'PAYMENT_METHOD_NOT_AVAILABLE' });
        }
        const actorContext = { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() };
        dto.discount = dto.discount ?? 0;
        dto.outlet_id = dto.outlet_id.toLowerCase();
        dto.customer_id = dto.customer_id?.toLowerCase();
        dto.client_transaction_id = dto.client_transaction_id.toLowerCase();
        dto.items = dto.items.map((item) => ({ ...item, product_id: item.product_id.toLowerCase() }))
            .sort((a, b) => a.product_id.localeCompare(b.product_id));

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.prisma.$transaction(
                    (tx) => this.checkout(tx, actorContext, dto),
                    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
                );
            } catch (error) {
                if (error instanceof HttpException) throw error;
                if (error instanceof Prisma.PrismaClientKnownRequestError) {
                    // A concurrent insert may win the idempotency key. Retry only after
                    // rollback, so the next transaction can read the committed winner.
                    const adapter = error.meta?.driverAdapterError as {
                        cause?: { constraint?: { index?: string; fields?: string[] } };
                    } | undefined;
                    const target = error.meta?.target ?? adapter?.cause?.constraint?.index ??
                        adapter?.cause?.constraint?.fields;
                    const duplicateRequest = error.code === 'P2002' && (
                        target === 'uq_transactions_client_id' ||
                        (Array.isArray(target) && target.includes('tenant_id') && target.includes('client_transaction_id'))
                    );
                    if (duplicateRequest || error.code === 'P2034') {
                        if (attempt < 2) continue;
                        throw new ServiceUnavailableException({ message: 'Please retry with the same client_transaction_id', error_code: 'TRANSACTION_RETRY_REQUIRED' });
                    }
                    if (error.code === 'P2003' || error.code === 'P2025') {
                        throw new ConflictException({ message: 'A transaction resource changed; please retry', error_code: 'TRANSACTION_RESOURCE_CONFLICT' });
                    }
                }
                this.logger.error('Checkout rolled back', error instanceof Error ? error.stack : undefined);
                throw new InternalServerErrorException('Unable to create transaction');
            }
        }
        throw new ServiceUnavailableException('Unable to create transaction');
    }

    async findAll(user: JwtPayload, input: QueryTransactionsDto) {
        const query = plainToInstance(QueryTransactionsDto, input);
        if (!query || (await validate(query, { whitelist: true, forbidNonWhitelisted: true })).length) {
            throw new BadRequestException('Invalid transaction query');
        }
        const skip = (query.page - 1) * query.limit;
        if (!Number.isSafeInteger(skip) || skip > 2147483647) {
            throw new BadRequestException('Pagination offset exceeds supported range');
        }
        return this.prisma.$transaction(async (tx) => {
            const scope = await this.readScope(tx, user, query.outlet_id);
            const where: Prisma.transactionsWhereInput = {
                ...scope,
                ...(query.status ? { status: query.status } : {}),
                ...(query.start_date || query.end_date ? {
                    created_at: {
                        ...(query.start_date ? { gte: new Date(query.start_date) } : {}),
                        ...(query.end_date ? { lt: new Date(query.end_date) } : {}),
                    },
                } : {}),
            };
            const total = await tx.transactions.count({ where });
            const rows = await tx.transactions.findMany({
                where,
                select: summarySelect,
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                skip,
                take: query.limit,
            });
            return {
                data: rows.map((row) => this.toSummary(row)),
                meta: { page: query.page, limit: query.limit, total, total_pages: Math.ceil(total / query.limit) },
            };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }

    async findOne(user: JwtPayload, id: string) {
        if (!isUUID(id)) throw new BadRequestException('Invalid transaction ID');
        return this.prisma.$transaction(async (tx) => {
            const scope = await this.readScope(tx, user);
            const transaction = await tx.transactions.findFirst({
                where: { ...scope, id: id.toLowerCase() },
                select: responseSelect,
            });
            if (!transaction) throw new NotFoundException('Transaction not found');
            return this.toResponse(transaction);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    }

    private async readScope(tx: Prisma.TransactionClient, user: JwtPayload, outletId?: string): Promise<Prisma.transactionsWhereInput> {
        if (!user || !isUUID(user.sub) || !isUUID(user.tenant_id)) {
            throw new UnauthorizedException('Invalid user context');
        }
        const tenant_id = user.tenant_id.toLowerCase();
        const actor = await tx.users.findFirst({
            where: { id: user.sub.toLowerCase(), tenant_id, is_active: true, tenants: { is_active: true } },
            select: { role: true, outlet_id: true },
        });
        if (!actor) throw new UnauthorizedException('User or tenant is inactive');
        if (!['OWNER', 'ADMIN', 'CASHIER'].includes(actor.role)) {
            throw new ForbiddenException('Role cannot view transactions');
        }
        let outlet_id = outletId?.toLowerCase();
        if (actor.role === 'CASHIER') {
            if (!actor.outlet_id || (outlet_id && outlet_id !== actor.outlet_id)) {
                throw new ForbiddenException('Outlet access denied');
            }
            outlet_id = actor.outlet_id;
        }
        if (outlet_id) {
            // Historical transactions remain readable when an outlet is deactivated.
            const outlet = await tx.outlets.findFirst({ where: { id: outlet_id, tenant_id }, select: { id: true } });
            if (!outlet) throw new NotFoundException('Outlet not found');
        }
        return { tenant_id, ...(outlet_id ? { outlet_id } : {}) };
    }

    private async checkout(tx: Prisma.TransactionClient, user: JwtPayload, dto: CreateTransactionDto) {
        const actor = await tx.users.findFirst({
            where: { id: user.sub, tenant_id: user.tenant_id, is_active: true },
            select: { outlet_id: true, role: true },
        });
        const tenant = await tx.tenants.findFirst({
            where: { id: user.tenant_id, is_active: true },
            select: { tax_enabled: true, tax_rate: true },
        });
        if (!actor || !tenant) throw new UnauthorizedException('User or tenant is inactive');
        if (!['OWNER', 'ADMIN', 'CASHIER'].includes(actor.role)) {
            throw new ForbiddenException('Role cannot create transactions');
        }
        if (actor.role === 'CASHIER' && actor.outlet_id !== dto.outlet_id) {
            throw new ForbiddenException({ message: 'Outlet access denied', error_code: 'OUTLET_ACCESS_DENIED' });
        }

        const existing = await tx.transactions.findFirst({
            where: { tenant_id: user.tenant_id, client_transaction_id: dto.client_transaction_id },
            select: responseSelect,
        });
        if (existing) {
            this.assertSameRequest(existing, user, dto);
            return this.toResponse(existing);
        }

        const outlet = await tx.outlets.findFirst({
            where: { id: dto.outlet_id, tenant_id: user.tenant_id, is_active: true },
            select: { id: true },
        });
        if (!outlet) throw new NotFoundException('Outlet not found');
        if (dto.customer_id) {
            const customer = await tx.customers.findFirst({
                where: { id: dto.customer_id, tenant_id: user.tenant_id },
                select: { id: true },
            });
            if (!customer) throw new NotFoundException('Customer not found');
        }
        if (dto.discount > 0 && actor.role === 'CASHIER') {
            throw new ForbiddenException('Manual discount requires OWNER or ADMIN');
        }
        const products = await tx.products.findMany({
            where: { tenant_id: user.tenant_id, is_active: true, id: { in: dto.items.map((item) => item.product_id) } },
            select: { id: true, price: true, cost: true },
        });
        if (products.length !== dto.items.length) throw new NotFoundException('Product not found');
        const productMap = new Map(products.map((product) => [product.id, product]));
        const items = dto.items.map((item) => {
            const product = productMap.get(item.product_id)!;
            return {
                tenant_id: user.tenant_id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: BigInt(product.price),
                unit_cost: BigInt(product.cost),
                subtotal: BigInt(product.price) * BigInt(item.quantity),
            };
        });
        const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0n);
        const discount = BigInt(dto.discount);
        if (discount > subtotal) throw new BadRequestException('Discount exceeds subtotal');
        // tax_rate is DECIMAL(5,2). Convert percent to basis points without floats.
        const rate = BigInt(tenant.tax_rate.toFixed(2).replace('.', ''));
        const taxableAmount = subtotal - discount;
        const tax = tenant.tax_enabled ? (taxableAmount * rate + 5000n) / 10000n : 0n;
        const total = subtotal - discount + tax;
        this.money(subtotal);
        this.money(tax);
        this.money(total);
        if (total <= 0n) throw new BadRequestException('Transaction total must be positive');
        const amount = BigInt(dto.payment.amount!);
        if (amount < total) {
            throw new BadRequestException({ message: 'Cash amount is less than total', error_code: 'INSUFFICIENT_PAYMENT' });
        }

        const transaction = await tx.transactions.create({
            data: {
                tenant_id: user.tenant_id,
                outlet_id: dto.outlet_id,
                user_id: user.sub,
                customer_id: dto.customer_id ?? null,
                client_transaction_id: dto.client_transaction_id,
                status: TransactionStatus.PENDING,
                subtotal, discount, tax, total,
            },
            select: { id: true },
        });
        await tx.transaction_items.createMany({
            data: items.map((item) => ({ ...item, transaction_id: transaction.id })),
        });

        // Stable product order limits deadlocks. Availability and decrement are
        // one SQL update; no separate read-then-write race or nested transaction.
        for (const item of items) {
            const updated = await tx.product_stocks.updateMany({
                where: {
                    outlet_id: dto.outlet_id,
                    product_id: item.product_id,
                    outlets: { tenant_id: user.tenant_id },
                    products: { tenant_id: user.tenant_id },
                    stock: { gte: item.quantity },
                },
                data: { stock: { decrement: item.quantity }, updated_at: new Date() },
            });
            if (updated.count !== 1) {
                throw new ConflictException({ message: 'Insufficient stock', error_code: 'INSUFFICIENT_STOCK', product_id: item.product_id });
            }
        }
        await tx.stock_movements.createMany({
            data: items.map((item) => ({
                tenant_id: user.tenant_id,
                outlet_id: dto.outlet_id,
                product_id: item.product_id,
                user_id: user.sub,
                type: 'SALE',
                quantity: -item.quantity,
                reference_type: 'TRANSACTION',
                reference_id: transaction.id,
            })),
        });
        await tx.payments.create({
            data: {
                tenant_id: user.tenant_id,
                transaction_id: transaction.id,
                method: PaymentMethod.CASH,
                status: PaymentStatus.PAID,
                amount,
                paid_at: new Date(),
            },
        });
        const completed = await tx.transactions.update({
            where: { id: transaction.id, tenant_id: user.tenant_id },
            data: { status: TransactionStatus.COMPLETED },
            select: responseSelect,
        });
        // Serialize before commit so a response-range failure rolls back writes.
        return this.toResponse(completed);
    }

    private assertSameRequest(existing: TransactionRecord, user: JwtPayload, dto: CreateTransactionDto) {
        const payment = existing.payments[0];
        const same = existing.user_id === user.sub && existing.outlet_id === dto.outlet_id &&
            existing.customer_id === (dto.customer_id ?? null) &&
            existing.discount === BigInt(dto.discount) && existing.payments.length === 1 &&
            payment.method === PaymentMethod.CASH && payment.amount === BigInt(dto.payment.amount!) &&
            existing.transaction_items.length === dto.items.length &&
            existing.transaction_items.every((item, index) =>
                item.product_id === dto.items[index].product_id && item.quantity === dto.items[index].quantity);
        if (!same) {
            throw new ConflictException({ message: 'client_transaction_id already belongs to a different request', error_code: 'IDEMPOTENCY_CONFLICT' });
        }
    }

    private money(value: bigint): number {
        if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new BadRequestException({ message: 'Money exceeds supported integer range', error_code: 'INVALID_AMOUNT' });
        }
        return Number(value);
    }

    private toSummary(transaction: TransactionSummary) {
        return {
            transaction_id: transaction.id,
            client_transaction_id: transaction.client_transaction_id,
            outlet_id: transaction.outlet_id,
            user_id: transaction.user_id,
            customer_id: transaction.customer_id,
            status: transaction.status,
            subtotal: this.money(transaction.subtotal),
            discount: this.money(transaction.discount),
            tax: this.money(transaction.tax),
            total: this.money(transaction.total),
            created_at: transaction.created_at,
        };
    }

    private toResponse(transaction: TransactionRecord) {
        const payment = transaction.payments.length === 1 ? transaction.payments[0] : undefined;
        const change = payment?.method === PaymentMethod.CASH && payment.status === PaymentStatus.PAID &&
            payment.amount >= transaction.total ? this.money(payment.amount - transaction.total) : null;
        return {
            ...this.toSummary(transaction),
            items: transaction.transaction_items.map((item) => ({
                ...item, unit_price: this.money(item.unit_price), subtotal: this.money(item.subtotal),
            })),
            payments: transaction.payments.map((payment) => ({ ...payment, amount: this.money(payment.amount) })),
            change,
            created_at: transaction.created_at,
        };
    }
}
