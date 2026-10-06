import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
  constructor(private readonly prisma: PrismaService) {}

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
    const scaledRate = this.scaledTaxRate(tenant.tax_rate);
    const tax_estimate = tenant.tax_enabled ? (subtotal_estimate * scaledRate + 5000n) / 10000n : 0n;
    const total_estimate = subtotal_estimate + tax_estimate;
    for (const value of [subtotal_estimate, tax_estimate, total_estimate]) this.money(value);
    return { subtotal_estimate, tax_estimate, total_estimate };
  }

  /**
   * Same interpretation as TransactionsService: a percentage with two decimals
   * becomes a basis-point integer, so both paths round tax identically.
   */
  private scaledTaxRate(taxRate: unknown) {
    const decimal = (taxRate as { toFixed?: (places: number) => string })?.toFixed;
    if (typeof decimal === 'function') return BigInt(decimal.call(taxRate, 2).replace('.', ''));
    return BigInt(Math.round(Number(taxRate) * 100));
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
