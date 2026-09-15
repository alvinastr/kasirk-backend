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
import { DailySalesQueryDto } from './dto/daily-sales-query.dto';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import type {
  DailySalesReport,
  ReportDateRange,
  SalesSummaryReport,
  TopProductReport,
} from './types/report.types';

const REPORT_STATUS = 'COMPLETED';
const JAKARTA_OFFSET = '+07:00';

interface ReportScope {
  tenantId: string;
  outletId?: string;
}

interface SummaryRow {
  transaction_count: string;
  gross_sales: string;
  discount: string;
  net_sales: string;
  tax_collected: string;
  total_sales: string;
  cogs: string;
}

interface TopProductRow {
  product_id: string;
  product_name: string;
  sku: string;
  quantity_sold: string;
  gross_sales: string;
  net_sales: string;
  cogs: string;
}

interface SummaryValues {
  transactionCount: bigint;
  grossSales: bigint;
  discount: bigint;
  netSales: bigint;
  taxCollected: bigint;
  totalSales: bigint;
  cogs: bigint;
  grossProfit: bigint;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  dailySales(
    user: JwtPayload,
    query: DailySalesQueryDto,
  ): Promise<DailySalesReport> {
    const range = this.dailyRange(query.date);

    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.reportScope(tx, user, query.outlet_id);
        const summary = await this.readSummary(tx, scope, range);

        return {
          date: query.date,
          outlet_id: scope.outletId ?? null,
          ...this.summaryResponse(summary),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  salesSummary(
    user: JwtPayload,
    query: SalesSummaryQueryDto,
  ): Promise<SalesSummaryReport> {
    const range = this.summaryRange(query.start_date, query.end_date);

    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.reportScope(tx, user, query.outlet_id);
        const summary = await this.readSummary(tx, scope, range);
        const average =
          summary.transactionCount === 0n
            ? 0n
            : (summary.netSales + summary.transactionCount / 2n) /
              summary.transactionCount;

        return {
          ...this.summaryResponse(summary),
          average_transaction: this.safeInteger(average),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  topProducts(
    user: JwtPayload,
    query: TopProductsQueryDto,
  ): Promise<TopProductReport[]> {
    const range = this.summaryRange(query.start_date, query.end_date);

    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.reportScope(tx, user, query.outlet_id);
        const outletFilter = scope.outletId
          ? Prisma.sql`AND t.outlet_id = ${scope.outletId}::uuid`
          : Prisma.empty;
        const rows = await tx.$queryRaw<TopProductRow[]>(Prisma.sql`
                SELECT
                    ti.product_id::text AS product_id,
                    p.name AS product_name,
                    p.sku,
                    SUM(ti.quantity)::text AS quantity_sold,
                    SUM(ti.subtotal)::text AS gross_sales,
                    ROUND(COALESCE(SUM(
                        CASE
                            WHEN t.subtotal > 0 THEN
                                ti.subtotal::numeric
                                * (t.subtotal - t.discount)::numeric
                                / t.subtotal::numeric
                            ELSE 0
                        END
                    ), 0))::text AS net_sales,
                    SUM(ti.quantity::numeric * ti.unit_cost::numeric)::text AS cogs
                FROM transaction_items ti
                INNER JOIN transactions t
                    ON t.id = ti.transaction_id
                    AND t.tenant_id = ti.tenant_id
                INNER JOIN products p
                    ON p.id = ti.product_id
                    AND p.tenant_id = ti.tenant_id
                WHERE ti.tenant_id = ${scope.tenantId}::uuid
                    AND t.tenant_id = ${scope.tenantId}::uuid
                    AND p.tenant_id = ${scope.tenantId}::uuid
                    AND t.status = ${REPORT_STATUS}
                    AND t.created_at >= ${range.start}
                    AND t.created_at < ${range.end}
                    ${outletFilter}
                GROUP BY ti.product_id, p.name, p.sku
                ORDER BY SUM(ti.quantity) DESC, SUM(ti.subtotal) DESC, ti.product_id ASC
                LIMIT ${query.limit}
            `);

        return rows.map((row) => {
          const grossSales = this.rawInteger(row.gross_sales);
          const netSales = this.rawInteger(row.net_sales);
          const cogs = this.rawInteger(row.cogs);

          return {
            product_id: row.product_id,
            product_name: row.product_name,
            sku: row.sku,
            quantity_sold: this.safeInteger(this.rawInteger(row.quantity_sold)),
            gross_sales: this.safeInteger(grossSales),
            cogs: this.safeInteger(cogs),
            gross_profit: this.safeInteger(netSales - cogs),
          };
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async reportScope(
    tx: Prisma.TransactionClient,
    user: JwtPayload,
    requestedOutletId?: string,
  ): Promise<ReportScope> {
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
    if (!['OWNER', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('Role cannot view reports');
    }

    const outletId = requestedOutletId?.toLowerCase();
    if (outletId) {
      const outlet = await tx.outlets.findFirst({
        where: { id: outletId, tenant_id: tenantId },
        select: { id: true },
      });
      if (!outlet) {
        throw new NotFoundException('Outlet not found');
      }
    }

    return { tenantId, ...(outletId ? { outletId } : {}) };
  }

  private async readSummary(
    tx: Prisma.TransactionClient,
    scope: ReportScope,
    range: ReportDateRange,
  ): Promise<SummaryValues> {
    const outletFilter = scope.outletId
      ? Prisma.sql`AND t.outlet_id = ${scope.outletId}::uuid`
      : Prisma.empty;
    const rows = await tx.$queryRaw<SummaryRow[]>(Prisma.sql`
            SELECT
                COUNT(t.id)::text AS transaction_count,
                COALESCE(SUM(t.subtotal), 0)::text AS gross_sales,
                COALESCE(SUM(t.discount), 0)::text AS discount,
                COALESCE(SUM(t.subtotal - t.discount), 0)::text AS net_sales,
                COALESCE(SUM(t.tax), 0)::text AS tax_collected,
                COALESCE(SUM(t.total), 0)::text AS total_sales,
                COALESCE(SUM(item_cost.cogs), 0)::text AS cogs
            FROM transactions t
            LEFT JOIN LATERAL (
                SELECT SUM(ti.quantity::numeric * ti.unit_cost::numeric) AS cogs
                FROM transaction_items ti
                WHERE ti.tenant_id = t.tenant_id
                    AND ti.transaction_id = t.id
                    AND ti.tenant_id = ${scope.tenantId}::uuid
            ) item_cost ON TRUE
            WHERE t.tenant_id = ${scope.tenantId}::uuid
                AND t.status = ${REPORT_STATUS}
                AND t.created_at >= ${range.start}
                AND t.created_at < ${range.end}
                ${outletFilter}
        `);
    const row = rows[0] ?? {
      transaction_count: '0',
      gross_sales: '0',
      discount: '0',
      net_sales: '0',
      tax_collected: '0',
      total_sales: '0',
      cogs: '0',
    };
    const netSales = this.rawInteger(row.net_sales);
    const cogs = this.rawInteger(row.cogs);

    return {
      transactionCount: this.rawInteger(row.transaction_count),
      grossSales: this.rawInteger(row.gross_sales),
      discount: this.rawInteger(row.discount),
      netSales,
      taxCollected: this.rawInteger(row.tax_collected),
      totalSales: this.rawInteger(row.total_sales),
      cogs,
      grossProfit: netSales - cogs,
    };
  }

  private summaryResponse(summary: SummaryValues) {
    return {
      transaction_count: this.safeInteger(summary.transactionCount),
      gross_sales: this.safeInteger(summary.grossSales),
      discount: this.safeInteger(summary.discount),
      net_sales: this.safeInteger(summary.netSales),
      tax_collected: this.safeInteger(summary.taxCollected),
      total_sales: this.safeInteger(summary.totalSales),
      cogs: this.safeInteger(summary.cogs),
      gross_profit: this.safeInteger(summary.grossProfit),
    };
  }

  private dailyRange(date: string): ReportDateRange {
    const start = this.dateBoundary(date);
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
  }

  private summaryRange(startDate: string, endDate: string): ReportDateRange {
    const start = this.dateBoundary(startDate);
    const end = this.dateBoundary(endDate);
    if (end <= start) {
      throw new BadRequestException('end_date must be later than start_date');
    }
    return { start, end };
  }

  private dateBoundary(date: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Date must use YYYY-MM-DD format');
    }
    const value = new Date(`${date}T00:00:00.000${JAKARTA_OFFSET}`);
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException('Invalid report date');
    }
    const jakartaCalendarDate = new Date(value.getTime() + 7 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (jakartaCalendarDate !== date) {
      throw new BadRequestException('Invalid report date');
    }
    return value;
  }

  private rawInteger(value: string): bigint {
    try {
      return BigInt(value);
    } catch {
      throw new InternalServerErrorException(
        'Invalid numeric value returned by report query',
      );
    }
  }

  private safeInteger(value: bigint): number {
    if (
      value < BigInt(Number.MIN_SAFE_INTEGER) ||
      value > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new InternalServerErrorException(
        'Report value exceeds supported integer range',
      );
    }
    return Number(value);
  }
}
