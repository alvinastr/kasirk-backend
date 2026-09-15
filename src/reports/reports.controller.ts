import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DailySalesQueryDto } from './dto/daily-sales-query.dto';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales/daily')
  dailySales(
    @CurrentUser() user: JwtPayload,
    @Query() query: DailySalesQueryDto,
  ) {
    return this.reportsService.dailySales(user, query);
  }

  @Get('sales/summary')
  salesSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: SalesSummaryQueryDto,
  ) {
    return this.reportsService.salesSummary(user, query);
  }

  @Get('products/top')
  topProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: TopProductsQueryDto,
  ) {
    return this.reportsService.topProducts(user, query);
  }
}
