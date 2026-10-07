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
import { TransactionsService, type CheckoutDto } from '../transactions/transactions.service';
import { CheckoutHeldOrderDto } from './dto/checkout-held-order.dto';
import type { CreateTransactionItemDto } from '../transactions/dto/create-transaction-item.dto';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { CancelHeldOrderDto } from './dto/cancel-held-order.dto';
import { CreateHeldOrderItemDto } from './dto/create-held-order-item.dto';
import { CreateHeldOrderDto } from './dto/create-held-order.dto';
import { QueryHeldOrdersDto } from './dto/query-held-orders.dto';
import { UpdateHeldOrderDto } from './dto/update-held-order.dto';
import { calculateTax } from '../common/utils/tax.util';

const detailInclude = Prisma.validator<Prisma.held_ordersInclude>()({
  users: { select: { id: true, name: true } },
  held_order_items: {
    include: { held_order_item_modifiers: { orderBy: { created_at: 'asc' } } },
    orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
  },
});

type Tx = Prisma.TransactionClient;
type Actor = { role: string; outlet_id: string | null };
type ResolvedOption = {
  id: string;
  modifier_group_id: string;
  group_name: string;
  option_name: string;
  price_delta: number;
};
type ResolvedItem = {
  product: { id: string; name: string; sku: string; price: number };
  quantity: number;
  note: string | null;
  options: ResolvedOption[];
  effectivePrice: bigint;
};

@Injectable()
export class HeldOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactionsService: TransactionsService,
  ) {}

  async create(user: JwtPayload, input: CreateHeldOrderDto) {
    const actor = this.actorContext(user);
    const dto = this.normalizeCreate(await this.validateDto(CreateHeldOrderDto, input));
    return this.prisma.$transaction(async (tx) => {
      const { tenant, principal } = await this.authorizeWrite(tx, actor, dto.outlet_id, dto.cashier_session_id);
      const resolved = await this.resolveItems(tx, actor.tenant_id, dto.items);
      const totals = this.totals(resolved, tenant);
      const order = await tx.held_orders.create({
        data: {
          tenant_id: actor.tenant_id,
          outlet_id: dto.outlet_id,
          origin_cashier_session_id: dto.cashier_session_id,
          cashier_user_id: actor.sub,
          label: this.label(dto.label),
          status: 'OPEN',
          version: 1,
          ...totals,
        },
        select: { id: true },
      });
      await this.persistItems(tx, actor.tenant_id, order.id, resolved);
      const created = await tx.held_orders.findFirst({
        where: { id: order.id, tenant_id: actor.tenant_id },
        include: detailInclude,
      });
      if (!created) throw new ConflictException({ message: 'Held order changed during creation', error_code: 'HELD_ORDER_RESOURCE_CONFLICT' });
      return this.toDetail(created, principal);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async findAll(user: JwtPayload, input: QueryHeldOrdersDto) {
    const actor = this.actorContext(user);
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const skip = (page - 1) * limit;
    if (!Number.isSafeInteger(skip) || skip > 2147483647) throw new BadRequestException('Pagination offset exceeds supported range');
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.readScope(tx, actor, input.outlet_id);
      const where = { ...scope, status: input.status ?? 'OPEN' };
      const total = await tx.held_orders.count({ where });
      const rows = await tx.held_orders.findMany({
        where,
        include: detailInclude,
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      });
      return {
        data: rows.map((row) => this.toSummary(row)),
        meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async findOne(user: JwtPayload, id: string) {
    const actor = this.actorContext(user);
    if (!isUUID(id)) throw new BadRequestException('Invalid held order ID');
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.readScope(tx, actor);
      const order = await tx.held_orders.findFirst({
        where: { ...scope, id: id.toLowerCase() },
        include: detailInclude,
      });
      if (!order) throw new NotFoundException({ message: 'Held order not found', error_code: 'HELD_ORDER_NOT_FOUND' });
      return this.toDetail(order);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async update(user: JwtPayload, id: string, input: UpdateHeldOrderDto) {
    const actor = this.actorContext(user);
    if (!isUUID(id)) throw new BadRequestException('Invalid held order ID');
    const orderId = id.toLowerCase();
    const dto = await this.validateDto(UpdateHeldOrderDto, input);
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.readScope(tx, actor);
      const current = await tx.held_orders.findFirst({ where: { ...scope, id: orderId }, include: detailInclude });
      if (!current) throw new NotFoundException({ message: 'Held order not found', error_code: 'HELD_ORDER_NOT_FOUND' });
      this.assertOpenVersion(current, dto.expected_version);

      let totals: { subtotal_estimate: bigint; tax_estimate: bigint; total_estimate: bigint } | undefined;
      let resolved: ResolvedItem[] | undefined;
      if (dto.items) {
        const tenant = await tx.tenants.findFirst({
          where: { id: actor.tenant_id, is_active: true },
          select: { tax_enabled: true, tax_rate: true },
        });
        if (!tenant) throw new UnauthorizedException('Tenant is inactive');
        resolved = await this.resolveItems(tx, actor.tenant_id, dto.items);
        totals = this.totals(resolved, tenant);
      }

      const updated = await tx.held_orders.updateMany({
        where: { id: orderId, tenant_id: actor.tenant_id, status: 'OPEN', version: dto.expected_version },
        data: {
          ...(dto.label !== undefined ? { label: this.label(dto.label) } : {}),
          ...totals,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw this.versionConflict();
      if (resolved) {
        await tx.held_order_items.deleteMany({ where: { tenant_id: actor.tenant_id, held_order_id: orderId } });
        await this.persistItems(tx, actor.tenant_id, orderId, resolved);
      }
      const result = await tx.held_orders.findFirst({ where: { id: orderId, tenant_id: actor.tenant_id }, include: detailInclude });
      if (!result) throw new ConflictException({ message: 'Held order changed during update', error_code: 'HELD_ORDER_RESOURCE_CONFLICT' });
      return this.toDetail(result);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async cancel(user: JwtPayload, id: string, input: CancelHeldOrderDto) {
    const actor = this.actorContext(user);
    if (!isUUID(id)) throw new BadRequestException('Invalid held order ID');
    const orderId = id.toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const scope = await this.readScope(tx, actor);
      const current = await tx.held_orders.findFirst({ where: { ...scope, id: orderId }, include: detailInclude });
      if (!current) throw new NotFoundException({ message: 'Held order not found', error_code: 'HELD_ORDER_NOT_FOUND' });
      this.assertOpenVersion(current, input.expected_version);
      const changed = await tx.held_orders.updateMany({
        where: { id: orderId, tenant_id: actor.tenant_id, status: 'OPEN', version: input.expected_version },
        data: { status: 'CANCELLED', cancelled_at: new Date(), version: { increment: 1 } },
      });
      if (changed.count !== 1) throw this.versionConflict();
      const result = await tx.held_orders.findFirst({ where: { id: orderId, tenant_id: actor.tenant_id }, include: detailInclude });
      if (!result) throw new ConflictException({ message: 'Held order changed during cancellation', error_code: 'HELD_ORDER_RESOURCE_CONFLICT' });
      return this.toDetail(result);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /**
   * M16C: the caller-owned boundary for held-order conversion. Owns DTO
   * validation, the bounded retry loop and the Prisma -> HTTP error mapping;
   * the sale logic itself stays in `TransactionsService.executeTransactionCore`
   * so the next caller decides its own retry policy for the same unit of work.
   *
   * Only genuinely retryable failures are retried, and only three times:
   * - P2034 serialization/write conflicts raised by this Serializable attempt.
   * - P2002 on the transaction idempotency unique index, where the next attempt
   *   re-runs the whole conversion and the core resolves the canonical
   *   existing transaction instead of inserting a second sale.
   * Everything else (held-order version/state conflicts, tenant/outlet/session
   * authorization, closed session, catalog/stock/payment domain errors and
   * unrelated P2002 constraints) fails on the first attempt.
   */
  async checkout(user: JwtPayload, id: string, input: CheckoutHeldOrderDto) {
    const actor = this.actorContext(user);
    if (!isUUID(id)) throw new BadRequestException('Invalid held order ID');
    const orderId = id.toLowerCase();
    const dto = await this.validateDto(CheckoutHeldOrderDto, input);

    const M16C_MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= M16C_MAX_ATTEMPTS; attempt++) {
      try {
        // One outer Serializable transaction per attempt: claim, sale and the
        // terminal transition commit or roll back as a single unit.
        return await this.prisma.$transaction(
          (tx) => this.convertHeldOrder(tx, actor, orderId, dto),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2034' || this.isTransactionIdempotencyConflict(error)) {
            if (attempt < M16C_MAX_ATTEMPTS) continue;
            throw new ServiceUnavailableException({ message: 'Please retry with the same client_transaction_id', error_code: 'TRANSACTION_RETRY_REQUIRED' });
          }
          if (error.code === 'P2003' || error.code === 'P2025') {
            throw new ConflictException({ message: 'A conversion resource changed; please retry', error_code: 'TRANSACTION_RESOURCE_CONFLICT' });
          }
        }
        throw new InternalServerErrorException({ message: 'Unable to convert held order', error_code: 'HELD_ORDER_CONVERSION_FAILED' });
      }
    }
    throw new ServiceUnavailableException({ message: 'Please retry with the same client_transaction_id', error_code: 'TRANSACTION_RETRY_REQUIRED' });
  }

  /**
   * Mirrors the idempotency arbiter in `TransactionsService.createInternal`: the
   * retryable P2002 is the `(tenant_id, client_transaction_id)` uniqueness path
   * only. Any other unique constraint is a real defect and must not be retried.
   */
  private isTransactionIdempotencyConflict(error: Prisma.PrismaClientKnownRequestError) {
    if (error.code !== 'P2002') return false;
    const adapter = error.meta?.driverAdapterError as {
      cause?: { constraint?: { index?: string; fields?: string[] } };
    } | undefined;
    const target = error.meta?.target ?? adapter?.cause?.constraint?.index ??
      adapter?.cause?.constraint?.fields;
    if (target === 'uq_transactions_client_id') return true;
    return Array.isArray(target) &&
      target.length === 2 &&
      target.includes('tenant_id') &&
      target.includes('client_transaction_id');
  }

  /**
   * M16C conversion body. Runs entirely inside the caller's transaction client
   * and never opens a nested transaction.
   */
  private async convertHeldOrder(tx: Prisma.TransactionClient, actor: JwtPayload, orderId: string, dto: CheckoutHeldOrderDto) {
      // Resolve scope and load held order with normalized items/modifiers
      const scope = await this.readScope(tx, actor);
      const heldOrder = await tx.held_orders.findFirst({
        where: { ...scope, id: orderId },
        include: {
          held_order_items: {
            include: { held_order_item_modifiers: { orderBy: { created_at: 'asc' } } },
            orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
          },
        },
      });

      if (!heldOrder) throw new NotFoundException({ message: 'Held order not found', error_code: 'HELD_ORDER_NOT_FOUND' });

      // Idempotent replay: if already converted, verify the linked transaction matches the idempotency key
      if (heldOrder.status === 'CONVERTED') {
        const existing = await tx.transactions.findFirst({
          where: { tenant_id: actor.tenant_id, client_transaction_id: dto.client_transaction_id.toLowerCase() },
          select: {
            id: true,
            tenant_id: true,
            client_transaction_id: true,
            outlet_id: true,
            user_id: true,
            cashier_session_id: true,
            customer_id: true,
            discount: true,
            status: true,
            subtotal: true,
            tax: true,
            total: true,
            created_at: true,
            transaction_items: {
              select: {
                id: true,
                product_id: true,
                quantity: true,
                note_snapshot: true,
                transaction_item_modifiers: { select: { modifier_option_id: true } },
              },
            },
            payments: { select: { id: true, method: true, status: true, amount: true, amount_received: true, change_amount: true, paid_at: true } },
          },
        });
        if (!existing) throw new ConflictException({ message: 'Held order is converted but linked transaction not found', error_code: 'HELD_ORDER_CONVERTED_NO_LINK' });
        if (existing.id !== heldOrder.converted_transaction_id) throw new ConflictException({ message: 'Held order converted to a different transaction', error_code: 'HELD_ORDER_LINK_MISMATCH' });
        // Rebuild the logical checkout request from the existing transaction and compare via core
        const replayDto: CheckoutDto = {
          client_transaction_id: dto.client_transaction_id.toLowerCase(),
          outlet_id: heldOrder.outlet_id,
          cashier_session_id: heldOrder.origin_cashier_session_id,
          discount: Number(existing.discount),
          items: existing.transaction_items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            modifier_option_ids: item.transaction_item_modifiers.map((m) => m.modifier_option_id).filter((id): id is string => id !== null),
            ...(item.note_snapshot !== null ? { note: item.note_snapshot } : {}),
          })),
          payment: dto.payment,
        };
        // Call core for exact request comparison; it will throw on mismatch
        return this.transactionsService.executeTransactionCore(tx, actor, replayDto, 'V1');
      }

      // Reject non-OPEN terminal states
      if (heldOrder.status !== 'OPEN') {
        throw new ConflictException({ message: 'Held order is not open', error_code: 'HELD_ORDER_NOT_OPEN' });
      }
      if (heldOrder.version !== dto.expected_version) {
        throw new ConflictException({ message: 'Held order version is stale', error_code: 'HELD_ORDER_VERSION_CONFLICT' });
      }

      // Validate outlet access for cashier
      if (actor.role === 'CASHIER') {
        const principal = await tx.users.findFirst({ where: { id: actor.sub, tenant_id: actor.tenant_id }, select: { outlet_id: true } });
        if (!principal?.outlet_id || principal.outlet_id !== heldOrder.outlet_id) {
          throw new ForbiddenException({ message: 'Outlet access denied', error_code: 'OUTLET_ACCESS_DENIED' });
        }
      }

      // Validate origin cashier session: must be OPEN, closed_at = null, same tenant, same outlet, same user
      const session = await tx.cashier_sessions.findFirst({
        where: { id: heldOrder.origin_cashier_session_id, tenant_id: actor.tenant_id, status: 'OPEN', closed_at: null },
        select: { id: true, outlet_id: true, user_id: true },
      });
      if (!session) throw new ForbiddenException({ message: 'Origin cashier session is not open or closed', error_code: 'INVALID_CASHIER_SESSION' });
      if (session.outlet_id !== heldOrder.outlet_id) throw new ForbiddenException({ message: 'Origin cashier session outlet does not match held order outlet', error_code: 'SESSION_OUTLET_MISMATCH' });
      if (session.user_id !== heldOrder.cashier_user_id) throw new ForbiddenException({ message: 'Origin cashier session user does not match held order cashier', error_code: 'SESSION_USER_MISMATCH' });

      // Claim the held order: increment version atomically, keep status OPEN
      const claimed = await tx.held_orders.updateMany({
        where: { id: orderId, tenant_id: actor.tenant_id, status: 'OPEN', version: dto.expected_version },
        data: { version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new ConflictException({ message: 'Held order version is stale', error_code: 'HELD_ORDER_VERSION_CONFLICT' });

      // Build CheckoutDto from held order (no snapshot prices)
      const items: CreateTransactionItemDto[] = heldOrder.held_order_items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        modifier_option_ids: item.held_order_item_modifiers.map((m) => m.modifier_option_id).filter((id): id is string => id !== null),
        ...(item.note_snapshot !== null ? { note: item.note_snapshot } : {}),
      }));

      const checkoutDto: CheckoutDto = {
        client_transaction_id: dto.client_transaction_id.toLowerCase(),
        outlet_id: heldOrder.outlet_id,
        cashier_session_id: heldOrder.origin_cashier_session_id,
        discount: 0,
        items,
        payment: dto.payment,
      };

      // Execute the authoritative V1 transaction core with the same tx
      const result = await this.transactionsService.executeTransactionCore(tx, actor, checkoutDto, 'V1');

      // Terminal update: mark held order CONVERTED with linked transaction id and timestamp
      const converted = await tx.held_orders.updateMany({
        where: { id: orderId, tenant_id: actor.tenant_id, status: 'OPEN', version: dto.expected_version + 1 },
        data: {
          status: 'CONVERTED',
          converted_transaction_id: result.transaction_id,
          converted_at: new Date(),
        },
      });
      if (converted.count !== 1) throw new ConflictException({ message: 'Held order changed after claim', error_code: 'HELD_ORDER_RESOURCE_CONFLICT' });

      return result;
  }

  private actorContext(user: JwtPayload) {
    if (!user || !isUUID(user.sub) || !isUUID(user.tenant_id)) throw new UnauthorizedException('Invalid user context');
    return { ...user, sub: user.sub.toLowerCase(), tenant_id: user.tenant_id.toLowerCase() };
  }

  /**
   * M16A: keep validation for callers that invoke the service outside HTTP so a
   * duplicate modifier_option_ids entry cannot be priced and snapshotted twice.
   */
  private async validateDto<T extends object>(type: new () => T, input: T): Promise<T> {
    const dto = plainToInstance(type, input);
    if ((await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).length) {
      throw new BadRequestException({ message: 'Invalid held order input', error_code: 'INVALID_HELD_ORDER_INPUT' });
    }
    return dto;
  }

  private normalizeCreate(input: CreateHeldOrderDto) {
    return {
      ...input,
      outlet_id: input.outlet_id.toLowerCase(),
      cashier_session_id: input.cashier_session_id.toLowerCase(),
      items: input.items.map((item) => this.normalizeItem(item)),
    };
  }

  private normalizeItem(item: CreateHeldOrderItemDto): CreateHeldOrderItemDto {
    return {
      ...item,
      product_id: item.product_id.toLowerCase(),
      modifier_option_ids: (item.modifier_option_ids ?? []).map((optionId) => optionId.toLowerCase()),
      note: item.note?.trim(),
    };
  }

  private async principal(tx: Tx, user: ReturnType<HeldOrdersService['actorContext']>): Promise<Actor> {
    const principal = await tx.users.findFirst({
      where: { id: user.sub, tenant_id: user.tenant_id, is_active: true, tenants: { is_active: true } },
      select: { role: true, outlet_id: true },
    });
    if (!principal) throw new UnauthorizedException('User or tenant is inactive');
    if (!['OWNER', 'ADMIN', 'CASHIER'].includes(principal.role)) throw new ForbiddenException('Role cannot access held orders');
    return principal;
  }

  private async readScope(tx: Tx, user: ReturnType<HeldOrdersService['actorContext']>, requestedOutlet?: string) {
    const principal = await this.principal(tx, user);
    let outlet_id = requestedOutlet?.toLowerCase();
    if (principal.role === 'CASHIER') {
      if (!principal.outlet_id || (outlet_id && outlet_id !== principal.outlet_id)) throw new ForbiddenException('Outlet access denied');
      outlet_id = principal.outlet_id;
    }
    if (outlet_id) {
      const outlet = await tx.outlets.findFirst({ where: { id: outlet_id, tenant_id: user.tenant_id, is_active: true }, select: { id: true } });
      if (!outlet) throw new NotFoundException('Outlet not found');
    }
    return { tenant_id: user.tenant_id, ...(outlet_id ? { outlet_id } : {}) };
  }

  private async authorizeWrite(tx: Tx, user: ReturnType<HeldOrdersService['actorContext']>, outletId: string, sessionId: string) {
    const principal = await this.principal(tx, user);
    if (principal.role === 'CASHIER' && (!principal.outlet_id || principal.outlet_id !== outletId)) {
      throw new ForbiddenException({ message: 'Outlet access denied', error_code: 'OUTLET_ACCESS_DENIED' });
    }
    const tenant = await tx.tenants.findFirst({ where: { id: user.tenant_id, is_active: true }, select: { tax_enabled: true, tax_rate: true } });
    if (!tenant) throw new UnauthorizedException('Tenant is inactive');
    const outlet = await tx.outlets.findFirst({ where: { id: outletId, tenant_id: user.tenant_id, is_active: true }, select: { id: true } });
    if (!outlet) throw new NotFoundException('Outlet not found');
    // M16D: serialize OPEN Held Order creation with shift close. The close
    // path locks this same origin session row before counting OPEN orders.
    // This lock must be acquired before the session validation and insert.
    await tx.$queryRaw`SELECT id FROM cashier_sessions
      WHERE id = ${sessionId} AND tenant_id = ${user.tenant_id}
      FOR UPDATE`;
    const session = await tx.cashier_sessions.findFirst({
      where: { id: sessionId, tenant_id: user.tenant_id, user_id: user.sub, status: 'OPEN' },
      select: { id: true, outlet_id: true },
    });
    if (!session) throw new ForbiddenException({ message: 'Cashier session is not open or owned by this actor', error_code: 'INVALID_CASHIER_SESSION' });
    if (session.outlet_id !== outletId) throw new ForbiddenException({ message: 'Cashier session outlet does not match held order outlet', error_code: 'SESSION_OUTLET_MISMATCH' });
    return { tenant, principal };
  }

  private async resolveItems(tx: Tx, tenantId: string, rawItems: CreateHeldOrderItemDto[]): Promise<ResolvedItem[]> {
    const items = rawItems.map((item) => this.normalizeItem(item));
    const productIds = [...new Set(items.map((item) => item.product_id))];
    const products = await tx.products.findMany({
      where: { tenant_id: tenantId, is_active: true, id: { in: productIds } },
      select: { id: true, name: true, sku: true, price: true },
    });
    if (products.length !== productIds.length) throw new ConflictException({ message: 'One or more products are unavailable', error_code: 'HELD_ORDER_CATALOG_CONFLICT' });
    const productMap = new Map(products.map((product) => [product.id, product]));
    const assignments = await tx.product_modifier_groups.findMany({
      where: { tenant_id: tenantId, product_id: { in: productIds }, modifier_groups: { is_active: true } },
      select: { product_id: true, modifier_group_id: true, required: true, selection_type: true, modifier_groups: { select: { name: true } } },
    });
    const requestedOptionIds = [...new Set(items.flatMap((item) => item.modifier_option_ids ?? []))];
    const options = requestedOptionIds.length ? await tx.modifier_options.findMany({
      where: { tenant_id: tenantId, id: { in: requestedOptionIds }, is_active: true },
      select: { id: true, modifier_group_id: true, name: true, price_delta: true },
    }) : [];
    const optionMap = new Map(options.map((option) => [option.id, option]));

    return items.map((item) => {
      const product = productMap.get(item.product_id)!;
      const itemAssignments = assignments.filter((assignment) => assignment.product_id === item.product_id);
      const resolvedOptions: ResolvedOption[] = [];
      if ((item.modifier_option_ids ?? []).length > 0) {
        const assignmentByGroup = new Map(itemAssignments.map((assignment) => [assignment.modifier_group_id, assignment]));
        for (const optionId of item.modifier_option_ids!) {
          const option = optionMap.get(optionId);
          if (!option) throw new BadRequestException({ message: 'Modifier option not found or inactive', error_code: 'MODIFIER_OPTION_NOT_FOUND' });
          const assignment = assignmentByGroup.get(option.modifier_group_id);
          if (!assignment) throw new BadRequestException({ message: 'Modifier group is not assigned to product', error_code: 'MODIFIER_GROUP_NOT_ASSIGNED' });
          resolvedOptions.push({
            id: option.id,
            modifier_group_id: option.modifier_group_id,
            group_name: assignment.modifier_groups.name,
            option_name: option.name,
            price_delta: option.price_delta,
          });
        }
      }
      for (const assignment of itemAssignments) {
        const count = resolvedOptions.filter((option) => option.modifier_group_id === assignment.modifier_group_id).length;
        if (assignment.required && assignment.selection_type === 'SINGLE' && count === 0) throw new BadRequestException({ message: 'Required single modifier is missing', error_code: 'REQUIRED_SINGLE_MODIFIER_MISSING' });
        if (assignment.required && assignment.selection_type === 'SINGLE' && count !== 1) throw new BadRequestException({ message: 'Required single modifier requires exactly one selection', error_code: 'REQUIRED_SINGLE_MODIFIER_VIOLATION' });
        if (!assignment.required && assignment.selection_type === 'SINGLE' && count > 1) throw new BadRequestException({ message: 'Optional single modifier allows at most one selection', error_code: 'OPTIONAL_SINGLE_MODIFIER_VIOLATION' });
        if (assignment.required && assignment.selection_type === 'MULTIPLE') throw new BadRequestException({ message: 'Required multiple modifiers are unsupported', error_code: 'REQUIRED_MULTIPLE_NOT_SUPPORTED' });
      }
      const delta = resolvedOptions.reduce((sum, option) => sum + option.price_delta, 0);
      const effectivePrice = BigInt(product.price + delta);
      // Bound the line, not just the order total: opposing deltas could
      // otherwise cancel in the aggregate and persist an unrepresentable line.
      this.money(effectivePrice);
      this.money(effectivePrice * BigInt(item.quantity));
      return { product, quantity: item.quantity, note: item.note || null, options: resolvedOptions, effectivePrice };
    });
  }

  private totals(items: ResolvedItem[], tenant: { tax_enabled: boolean; tax_rate: unknown }) {
    const subtotal_estimate = items.reduce((sum, item) => sum + item.effectivePrice * BigInt(item.quantity), 0n);
    // M16B: shared tax helper — same arithmetic as TransactionsService, proven
    // byte-for-byte equivalent by src/common/utils/tax.util.spec.ts.
    // `total` from the helper is already `taxableAmount + tax`; do NOT add subtotal again.
    const { tax: tax_estimate, total: total_estimate } = calculateTax(
      tenant.tax_enabled,
      tenant.tax_rate,
      subtotal_estimate,
    );
    for (const value of [subtotal_estimate, tax_estimate, total_estimate]) this.money(value);
    return { subtotal_estimate, tax_estimate, total_estimate };
  }

  private async persistItems(tx: Tx, tenantId: string, heldOrderId: string, items: ResolvedItem[]) {
    for (let displayOrder = 0; displayOrder < items.length; displayOrder++) {
      const item = items[displayOrder];
      const lineTotal = item.effectivePrice * BigInt(item.quantity);
      const persisted = await tx.held_order_items.create({
        data: {
          tenant_id: tenantId,
          held_order_id: heldOrderId,
          product_id: item.product.id,
          quantity: item.quantity,
          product_name_snapshot: item.product.name,
          sku_snapshot: item.product.sku,
          base_price_snapshot: BigInt(item.product.price),
          effective_price_snapshot: item.effectivePrice,
          line_subtotal: lineTotal,
          line_discount: 0n,
          line_total: lineTotal,
          note_snapshot: item.note,
          display_order: displayOrder,
        },
        select: { id: true },
      });
      if (item.options.length) {
        await tx.held_order_item_modifiers.createMany({ data: item.options.map((option) => ({
          tenant_id: tenantId,
          held_order_item_id: persisted.id,
          modifier_group_id: option.modifier_group_id,
          modifier_option_id: option.id,
          group_name_snapshot: option.group_name,
          option_name_snapshot: option.option_name,
          price_delta_snapshot: option.price_delta,
        })) });
      }
    }
  }

  private assertOpenVersion(order: { status: string; version: number }, expectedVersion: number) {
    if (order.status !== 'OPEN') throw new ConflictException({ message: 'Held order is not open', error_code: 'HELD_ORDER_NOT_OPEN' });
    if (order.version !== expectedVersion) throw this.versionConflict();
  }

  private versionConflict() {
    return new ConflictException({ message: 'Held order version is stale', error_code: 'HELD_ORDER_VERSION_CONFLICT' });
  }

  private label(value: string | null | undefined) {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  private money(value: bigint) {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException({ message: 'Held order total is outside supported range', error_code: 'HELD_ORDER_TOTAL_OUT_OF_RANGE' });
  }

  private toSummary(order: any) {
    return {
      held_order_id: order.id,
      outlet_id: order.outlet_id,
      cashier_session_id: order.origin_cashier_session_id,
      cashier_user_id: order.cashier_user_id,
      cashier_name: order.users?.name ?? null,
      label: order.label,
      status: order.status,
      version: order.version,
      subtotal_estimate: Number(order.subtotal_estimate),
      tax_estimate: Number(order.tax_estimate),
      total_estimate: Number(order.total_estimate),
      item_count: (order.held_order_items ?? []).reduce((sum: number, item: any) => sum + item.quantity, 0),
      created_at: order.created_at,
      updated_at: order.updated_at,
      cancelled_at: order.cancelled_at,
      converted_at: order.converted_at,
    };
  }

  private toDetail(order: any, principal?: Actor) {
    return {
      ...this.toSummary(order),
      ...(principal ? { actor_role: principal.role } : {}),
      converted_transaction_id: order.converted_transaction_id,
      items: (order.held_order_items ?? []).map((item: any) => ({
        held_order_item_id: item.id,
        product_id: item.product_id,
        quantity: item.quantity,
        product_name: item.product_name_snapshot,
        sku: item.sku_snapshot,
        base_price: Number(item.base_price_snapshot),
        effective_price: Number(item.effective_price_snapshot),
        line_subtotal: Number(item.line_subtotal ?? BigInt(item.effective_price_snapshot) * BigInt(item.quantity)),
        line_discount: Number(item.line_discount ?? 0),
        line_total: Number(item.line_total ?? BigInt(item.effective_price_snapshot) * BigInt(item.quantity)),
        note: item.note_snapshot,
        display_order: item.display_order,
        modifiers: (item.held_order_item_modifiers ?? []).map((modifier: any) => ({
          held_order_item_modifier_id: modifier.id,
          modifier_group_id: modifier.modifier_group_id,
          modifier_option_id: modifier.modifier_option_id,
          group_name: modifier.group_name_snapshot,
          option_name: modifier.option_name_snapshot,
          price_delta: modifier.price_delta_snapshot,
        })),
      })),
    };
  }
}
