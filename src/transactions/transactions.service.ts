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
    cashier_session_id: true,
    transaction_items: {
        select: {
            id: true,
            product_id: true,
            quantity: true,
            unit_price: true,
            unit_cost: true,
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
                orderBy: { created_at: 'asc' },
            },
        },
        orderBy: { created_at: 'asc' },
    },
    payments: {
        select: { id: true, method: true, status: true, amount: true, amount_received: true, change_amount: true, paid_at: true },
        orderBy: { created_at: 'asc' },
    },
} satisfies Prisma.transactionsSelect;

type TransactionSummary = Prisma.transactionsGetPayload<{ select: typeof summarySelect }>;
type TransactionRecord = Prisma.transactionsGetPayload<{ select: typeof responseSelect }>;

interface ResolvedProduct {
    id: string;
    name: string;
    sku: string;
    price: number;
    cost: number;
    track_stock: boolean;
}

interface ResolvedOption {
    id: string;
    modifier_group_id: string;
    group_name: string;
    option_name: string;
    price_delta: number;
}

interface ValidatedItem {
    product: ResolvedProduct;
    options: ResolvedOption[];
    effectivePrice: bigint;
    quantity: number;
    note?: string;
}

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
        if (!dto) {
            throw new BadRequestException({ message: 'Invalid transaction input', error_code: 'INVALID_INPUT' });
        }
        const validationErrors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
        if (validationErrors.length) {
            const payment = dto.payment as unknown;
            if (payment !== null && typeof payment === 'object' && !Array.isArray(payment)) {
                const method = (payment as { method?: unknown }).method;
                if (method === PaymentMethod.CASH || method === PaymentMethod.QRIS) {
                    this.assertPaymentShape(dto);
                }
            }
            throw new BadRequestException({ message: 'Invalid transaction input', error_code: 'INVALID_INPUT' });
        }
        this.assertPaymentShape(dto);
        const actorContext = { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() };
        dto.discount = dto.discount ?? 0;
        dto.outlet_id = dto.outlet_id.toLowerCase();
        dto.customer_id = dto.customer_id?.toLowerCase();
        dto.client_transaction_id = dto.client_transaction_id.toLowerCase();
        dto.cashier_session_id = dto.cashier_session_id.toLowerCase();
        // Preserve original line order; do not sort by product_id so duplicate
        // product lines with different modifiers/notes remain distinct.
        dto.items = dto.items.map((item) => ({
            ...item,
            product_id: item.product_id.toLowerCase(),
            modifier_option_ids: (item.modifier_option_ids ?? []).map((id) => id.toLowerCase()),
            note: item.note?.trim(),
        }));

        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await this.prisma.$transaction(
                    (tx) => this.checkout(tx, actorContext, dto),
                    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
                );
            } catch (error) {
                if (error instanceof HttpException) throw error;
                if (error instanceof Prisma.PrismaClientKnownRequestError) {
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
            // Legacy rows have NULL snapshots. One bounded, tenant-scoped lookup
            // supplies readable names without an N+1 loop or a product join on
            // every read, including V1-only detail requests.
            const legacyProductIds = [...new Set(
                transaction.transaction_items
                    .filter((item) => item.product_name_snapshot === null)
                    .map((item) => item.product_id),
            )];
            const legacyProducts = legacyProductIds.length
                ? await tx.products.findMany({
                    where: { tenant_id: user.tenant_id.toLowerCase(), id: { in: legacyProductIds } },
                    select: { id: true, name: true, sku: true },
                })
                : [];
            return this.toResponse(transaction, new Map(legacyProducts.map((p) => [p.id, p])));
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

        // Idempotency: locate existing transaction before revalidating mutable
        // operational state such as an open session or active catalog rows.
        const existing = await tx.transactions.findFirst({
            where: { tenant_id: user.tenant_id, client_transaction_id: dto.client_transaction_id },
            select: responseSelect,
        });
        if (existing) {
            this.assertSameRequest(existing, user, dto);
            return this.toResponse(existing);
        }

        // V1-M4: validate the explicitly supplied cashier session for ALL roles.
        const session = await tx.cashier_sessions.findFirst({
            where: {
                id: dto.cashier_session_id,
                tenant_id: user.tenant_id,
                user_id: user.sub,
                status: 'OPEN',
            },
            select: { id: true, outlet_id: true },
        });
        if (!session) {
            throw new ForbiddenException({
                message: 'Cashier session not found, not open, or does not belong to this actor',
                error_code: 'INVALID_CASHIER_SESSION',
            });
        }
        if (session.outlet_id !== dto.outlet_id) {
            throw new ForbiddenException({
                message: 'Cashier session outlet does not match transaction outlet',
                error_code: 'SESSION_OUTLET_MISMATCH',
            });
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

        // V1-M4: resolve unique products (duplicate product lines are allowed).
        const uniqueProductIds = [...new Set(dto.items.map((item) => item.product_id))];
        const products = await tx.products.findMany({
            where: { tenant_id: user.tenant_id, is_active: true, id: { in: uniqueProductIds } },
            select: { id: true, name: true, sku: true, price: true, cost: true, track_stock: true },
        });
        if (products.length !== uniqueProductIds.length) throw new NotFoundException('One or more products not found or inactive');
        const productMap = new Map(products.map((p) => [p.id, p]));

        // Pre-load modifier assignments for all requested products.
        const assignments = await tx.product_modifier_groups.findMany({
            where: {
                tenant_id: user.tenant_id,
                product_id: { in: uniqueProductIds },
                modifier_groups: { is_active: true },
            },
            select: {
                product_id: true,
                modifier_group_id: true,
                required: true,
                selection_type: true,
                modifier_groups: { select: { name: true } },
            },
        });

        // Collect all group IDs referenced by assignments to batch-load options later.
        const assignmentGroupIds = [...new Set(assignments.map((a) => a.modifier_group_id))];
        const allOptionsForGroups = assignmentGroupIds.length > 0
            ? await tx.modifier_options.findMany({
                  where: {
                      tenant_id: user.tenant_id,
                      modifier_group_id: { in: assignmentGroupIds },
                      is_active: true,
                  },
                  select: {
                      id: true,
                      modifier_group_id: true,
                      name: true,
                      price_delta: true,
                  },
              })
            : [];
        const optionMap = new Map(allOptionsForGroups.map((o) => [o.id, o]));

        // Group assignments by product_id for O(1) lookup during line validation.
        const assignmentsByProduct = new Map<string, typeof assignments>();
        for (const productId of uniqueProductIds) {
            assignmentsByProduct.set(productId, assignments.filter((a) => a.product_id === productId));
        }

        // Validate every line, resolve modifiers, compute effective prices.
        const validatedItems: ValidatedItem[] = [];
        for (const item of dto.items) {
            const product = productMap.get(item.product_id);
            if (!product) throw new NotFoundException(`Product ${item.product_id} not found`);

            const itemAssignments = assignmentsByProduct.get(item.product_id) ?? [];
            const resolvedOptions: ResolvedOption[] = [];

            if ((item.modifier_option_ids?.length ?? 0) > 0) {
                for (const optId of item.modifier_option_ids!) {
                    const opt = optionMap.get(optId);
                    if (!opt) {
                        throw new BadRequestException({
                            message: `Modifier option ${optId} not found or inactive`,
                            error_code: 'MODIFIER_OPTION_NOT_FOUND',
                        });
                    }
                    // Verify the option's group is assigned to this product.
                    const assigned = itemAssignments.find((a) => a.modifier_group_id === opt.modifier_group_id);
                    if (!assigned) {
                        throw new BadRequestException({
                            message: `Modifier option ${optId} belongs to a group not assigned to this product`,
                            error_code: 'MODIFIER_GROUP_NOT_ASSIGNED',
                        });
                    }
                    if (!assigned.modifier_groups?.name) {
                        throw new InternalServerErrorException({
                            message: 'Validated modifier group is missing snapshot data',
                            error_code: 'MODIFIER_SNAPSHOT_INVARIANT_VIOLATION',
                        });
                    }
                    resolvedOptions.push({
                        id: opt.id,
                        modifier_group_id: opt.modifier_group_id,
                        group_name: assigned.modifier_groups.name,
                        option_name: opt.name,
                        price_delta: opt.price_delta,
                    });
                }

                // Enforce selection-type rules per assigned group.
                const groupSelections = new Map<string, number>();
                for (const opt of resolvedOptions) {
                    groupSelections.set(opt.modifier_group_id, (groupSelections.get(opt.modifier_group_id) ?? 0) + 1);
                }
                for (const assign of itemAssignments) {
                    const count = groupSelections.get(assign.modifier_group_id) ?? 0;
                    if (assign.required && assign.selection_type === 'SINGLE' && count !== 1) {
                        throw new BadRequestException({
                            message: `Required single-selection modifier group requires exactly one option`,
                            error_code: 'REQUIRED_SINGLE_MODIFIER_VIOLATION',
                        });
                    }
                    if (!assign.required && assign.selection_type === 'SINGLE' && count > 1) {
                        throw new BadRequestException({
                            message: `Optional single-selection modifier group allows at most one option`,
                            error_code: 'OPTIONAL_SINGLE_MODIFIER_VIOLATION',
                        });
                    }
                    if (assign.selection_type === 'MULTIPLE' && assign.required) {
                        throw new BadRequestException({
                            message: `Required multiple-selection modifier groups are not yet supported`,
                            error_code: 'REQUIRED_MULTIPLE_NOT_SUPPORTED',
                        });
                    }
                }
            } else {
                // No selections: verify no required SINGLE group is unsatisfied.
                for (const assign of itemAssignments) {
                    if (assign.required && assign.selection_type === 'SINGLE') {
                        throw new BadRequestException({
                            message: `Required single-selection modifier group has no selection`,
                            error_code: 'REQUIRED_SINGLE_MODIFIER_MISSING',
                        });
                    }
                }
            }

            // Compute effective price: base + sum of option deltas.
            const deltaSum = resolvedOptions.reduce((sum, o) => sum + o.price_delta, 0);
            const effectivePrice = BigInt(product.price) + BigInt(deltaSum);

            validatedItems.push({
                product,
                options: resolvedOptions,
                effectivePrice,
                quantity: item.quantity,
                note: item.note,
            });
        }

        // Compute totals.
        const itemsForPersistence = validatedItems.map((vi) => ({
            tenant_id: user.tenant_id,
            product_id: vi.product.id,
            quantity: vi.quantity,
            unit_price: vi.effectivePrice,
            unit_cost: BigInt(vi.product.cost),
            subtotal: vi.effectivePrice * BigInt(vi.quantity),
            track_stock: vi.product.track_stock,
            product_name_snapshot: vi.product.name,
            sku_snapshot: vi.product.sku,
            base_price_snapshot: BigInt(vi.product.price),
            effective_price_snapshot: vi.effectivePrice,
            note_snapshot: vi.note ?? null,
        }));
        const subtotal = itemsForPersistence.reduce((sum, item) => sum + item.subtotal, 0n);
        const discount = BigInt(dto.discount);
        if (discount > subtotal) throw new BadRequestException('Discount exceeds subtotal');
        const rate = BigInt(tenant.tax_rate.toFixed(2).replace('.', ''));
        const taxableAmount = subtotal - discount;
        const tax = tenant.tax_enabled ? (taxableAmount * rate + 5000n) / 10000n : 0n;
        const total = subtotal - discount + tax;
        this.money(subtotal);
        this.money(tax);
        this.money(total);
        if (total <= 0n) throw new BadRequestException('Transaction total must be positive');
        const resolvedTender = this.resolveTender(dto.payment);
        if (resolvedTender !== null && resolvedTender < total) {
            throw new BadRequestException({ message: 'Cash amount received is less than total', error_code: 'CASH_UNDERPAYMENT' });
        }

        // Persist transaction header with cashier_session_id.
        const transaction = await tx.transactions.create({
            data: {
                tenant_id: user.tenant_id,
                outlet_id: dto.outlet_id,
                user_id: user.sub,
                customer_id: dto.customer_id ?? null,
                cashier_session_id: dto.cashier_session_id,
                client_transaction_id: dto.client_transaction_id,
                status: TransactionStatus.PENDING,
                subtotal, discount, tax, total,
            },
            select: { id: true },
        });

        // Create lines individually so each generated ID remains paired with its
        // exact request line, including duplicate products with distinct notes.
        const persistedItems = [] as { id: string }[];
        for (const item of itemsForPersistence) {
            persistedItems.push(await tx.transaction_items.create({
                data: {
                    tenant_id: item.tenant_id,
                    transaction_id: transaction.id,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    unit_cost: item.unit_cost,
                    subtotal: item.subtotal,
                    product_name_snapshot: item.product_name_snapshot,
                    sku_snapshot: item.sku_snapshot,
                    base_price_snapshot: item.base_price_snapshot,
                    effective_price_snapshot: item.effective_price_snapshot,
                    note_snapshot: item.note_snapshot,
                },
                select: { id: true },
            }));
        }

        // Persist modifier snapshots.
        const modifierSnapshots: { tenant_id: string; transaction_id: string; transaction_item_id: string; modifier_group_id: string; modifier_option_id: string; group_name_snapshot: string; option_name_snapshot: string; price_delta_snapshot: number }[] = [];
        for (let i = 0; i < validatedItems.length; i++) {
            const vi = validatedItems[i];
            const pItem = persistedItems[i];
            for (const opt of vi.options) {
                modifierSnapshots.push({
                    tenant_id: user.tenant_id,
                    transaction_id: transaction.id,
                    transaction_item_id: pItem.id,
                    modifier_group_id: opt.modifier_group_id,
                    modifier_option_id: opt.id,
                    group_name_snapshot: opt.group_name,
                    option_name_snapshot: opt.option_name,
                    price_delta_snapshot: opt.price_delta,
                });
            }
        }
        if (modifierSnapshots.length > 0) {
            await tx.transaction_item_modifiers.createMany({ data: modifierSnapshots });
        }

        // Stable product order limits deadlocks. Aggregate stock per product to
        // avoid double-decrement when the same tracked product appears on multiple lines.
        const stockByProduct = new Map<string, number>();
        for (const vi of validatedItems) {
            if (vi.product.track_stock) {
                stockByProduct.set(
                    vi.product.id,
                    (stockByProduct.get(vi.product.id) ?? 0) + vi.quantity,
                );
            }
        }
        for (const [productQty, qty] of stockByProduct) {
            const updated = await tx.product_stocks.updateMany({
                where: {
                    outlet_id: dto.outlet_id,
                    product_id: productQty,
                    outlets: { tenant_id: user.tenant_id },
                    products: { tenant_id: user.tenant_id },
                    stock: { gte: qty },
                },
                data: { stock: { decrement: qty }, updated_at: new Date() },
            });
            if (updated.count !== 1) {
                throw new ConflictException({ message: 'Insufficient stock', error_code: 'INSUFFICIENT_STOCK', product_id: productQty });
            }
        }
        if (stockByProduct.size > 0) {
            const movementEntries: { tenant_id: string; outlet_id: string; product_id: string; user_id: string; type: string; quantity: number; reference_type: string; reference_id: string }[] = [];
            for (const [productQty, qty] of stockByProduct) {
                movementEntries.push({
                    tenant_id: user.tenant_id,
                    outlet_id: dto.outlet_id,
                    product_id: productQty,
                    user_id: user.sub,
                    type: 'SALE',
                    quantity: -qty,
                    reference_type: 'TRANSACTION',
                    reference_id: transaction.id,
                });
            }
            await tx.stock_movements.createMany({ data: movementEntries });
        }
        await tx.payments.create({
            data: {
                tenant_id: user.tenant_id,
                transaction_id: transaction.id,
                method: dto.payment.method,
                status: PaymentStatus.PAID,
                amount: total,
                amount_received: resolvedTender,
                change_amount: resolvedTender !== null ? resolvedTender - total : null,
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
        // Item order and modifier-option order have no semantic meaning. Preserve
        // duplicate-line multiplicity by comparing sorted canonical line keys.
        const persistedLines = existing.transaction_items.map((item) => JSON.stringify({
            product_id: item.product_id,
            quantity: item.quantity,
            note: item.note_snapshot ?? null,
            modifier_option_ids: item.transaction_item_modifiers
                .map((modifier) => modifier.modifier_option_id)
                .filter((id): id is string => id !== null)
                .sort(),
        })).sort();
        const requestedLines = dto.items.map((item) => JSON.stringify({
            product_id: item.product_id,
            quantity: item.quantity,
            note: item.note ?? null,
            modifier_option_ids: [...(item.modifier_option_ids ?? [])].sort(),
        })).sort();
        const same =
            existing.user_id === user.sub &&
            existing.outlet_id === dto.outlet_id &&
            existing.cashier_session_id === dto.cashier_session_id &&
            existing.customer_id === (dto.customer_id ?? null) &&
            existing.discount === BigInt(dto.discount) &&
            existing.payments.length === 1 &&
            this.samePayment(payment, dto) &&
            JSON.stringify(persistedLines) === JSON.stringify(requestedLines);
        if (!same) {
            throw new ConflictException({
                message: 'client_transaction_id already belongs to a different request',
                error_code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            });
        }
    }

    private resolveTender(payment: CreateTransactionDto['payment']): bigint | null {
        if (payment.method !== PaymentMethod.CASH) return null;
        return BigInt((payment.amount_received ?? payment.amount)!);
    }

    private samePayment(payment: TransactionRecord['payments'][number] | undefined, dto: CreateTransactionDto): boolean {
        if (!payment || payment.method !== dto.payment.method) return false;
        if (dto.payment.method === PaymentMethod.CASH) {
            const requestedTender = this.resolveTender(dto.payment);
            // Pre-M5 CASH rows stored tender in amount and have no amount_received.
            // Newly processed M5 rows always compare the canonical amount_received.
            const persistedTender = payment.amount_received ?? payment.amount;
            return persistedTender === requestedTender;
        }
        if (dto.payment.method === PaymentMethod.QRIS) {
            return payment.amount_received === null && payment.change_amount === null;
        }
        return false;
    }

    private shiftRequired() {
        return new ForbiddenException({
            message: 'Cashier must have an open shift before creating transactions',
            error_code: 'OPEN_SHIFT_REQUIRED',
        });
    }

    /**
     * M5: Validate payment shape before transaction processing.
     * - CASH: exactly one of legacy amount or V1 amount_received.
     * - QRIS: no cash fields.
     */
    private assertPaymentShape(dto: CreateTransactionDto) {
        const p = dto.payment;
        if ('change_amount' in (p as unknown as Record<string, unknown>)) {
            throw new BadRequestException({
                message: 'change_amount is server-derived and must not be supplied',
                error_code: 'PAYMENT_FIELD_NOT_ALLOWED',
            });
        }
        if (p.method === PaymentMethod.CASH) {
            const hasLegacy = p.amount !== undefined;
            const hasV1 = p.amount_received !== undefined;
            if (!hasLegacy && !hasV1) {
                throw new BadRequestException({
                    message: 'CASH requires amount_received',
                    error_code: 'CASH_AMOUNT_RECEIVED_REQUIRED',
                });
            }
            if (hasLegacy && hasV1) {
                throw new BadRequestException({
                    message: 'Cash payment fields are mutually exclusive; use payment.amount (legacy) or payment.amount_received (V1)',
                    error_code: 'PAYMENT_FIELD_NOT_ALLOWED',
                });
            }
            return;
        }
        if (p.method === PaymentMethod.QRIS) {
            if (p.amount !== undefined || p.amount_received !== undefined) {
                throw new BadRequestException({
                    message: 'QRIS must not carry cash payment fields',
                    error_code: 'PAYMENT_FIELD_NOT_ALLOWED',
                });
            }
            return;
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

    private toResponse(
        transaction: TransactionRecord,
        legacyProducts: Map<string, { id: string; name: string; sku: string }> = new Map(),
    ) {
        const payment = transaction.payments.length === 1 ? transaction.payments[0] : undefined;
        const change = payment?.change_amount != null ? this.money(payment.change_amount) : null;
        return {
            ...this.toSummary(transaction),
            cashier_session_id: transaction.cashier_session_id,
            items: transaction.transaction_items.map((item) => {
                // Snapshots stay authoritative. Display fields resolve NULL
                // legacy snapshots from the bounded product lookup, and legacy
                // rows reuse their historical unit_price because master price is
                // mutable current state, not the price actually sold.
                const isV1Snapshot = item.product_name_snapshot !== null;
                const legacyProduct = legacyProducts.get(item.product_id);
                return {
                id: item.id,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: this.money(item.unit_price),
                unit_cost: this.money(item.unit_cost),
                subtotal: this.money(item.subtotal),
                product_name_snapshot: item.product_name_snapshot,
                sku_snapshot: item.sku_snapshot,
                base_price_snapshot: item.base_price_snapshot != null ? this.money(item.base_price_snapshot) : null,
                effective_price_snapshot: item.effective_price_snapshot != null ? this.money(item.effective_price_snapshot) : null,
                note_snapshot: item.note_snapshot,
                product_name: isV1Snapshot ? item.product_name_snapshot : legacyProduct?.name ?? null,
                sku: isV1Snapshot ? item.sku_snapshot : legacyProduct?.sku ?? null,
                base_price: isV1Snapshot
                    ? (item.base_price_snapshot != null ? this.money(item.base_price_snapshot) : null)
                    : this.money(item.unit_price),
                effective_price: isV1Snapshot
                    ? (item.effective_price_snapshot != null ? this.money(item.effective_price_snapshot) : null)
                    : this.money(item.unit_price),
                note: item.note_snapshot,
                modifiers: (item.transaction_item_modifiers ?? []).map((m) => ({
                    id: m.id,
                    modifier_group_id: m.modifier_group_id,
                    modifier_option_id: m.modifier_option_id,
                    group_name_snapshot: m.group_name_snapshot,
                    option_name_snapshot: m.option_name_snapshot,
                    price_delta_snapshot: m.price_delta_snapshot,
                })),
                };
            }),
            payments: transaction.payments.map((p) => ({
                ...p,
                amount: this.money(p.amount),
                amount_received: p.amount_received != null ? this.money(p.amount_received) : null,
                change_amount: p.change_amount != null ? this.money(p.change_amount) : null,
            })),
            change,
            created_at: transaction.created_at,
        };
    }
}
