import {
  Controller,
  Get,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { DailySalesQueryDto } from './dto/daily-sales-query.dto';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
@ApiBearerAuth('JWT')
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
  @ApiOperation({
    summary: 'Daily sales report',
    description: 'Retrieve aggregated sales data grouped by day with optional date range and outlet filtering. OWNER and ADMIN roles only.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  dailySales(
    @CurrentUser() user: JwtPayload,
    @Query() query: DailySalesQueryDto,
  ) {
    return this.reportsService.dailySales(user, query);
  }

  @Get('sales/summary')
  @ApiOperation({
    summary: 'Sales summary report',
    description: 'Retrieve total sales, transaction count, and average transaction value with optional date range and outlet filtering. OWNER and ADMIN roles only.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  salesSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: SalesSummaryQueryDto,
  ) {
    return this.reportsService.salesSummary(user, query);
  }

  @Get('products/top')
  @ApiOperation({
    summary: 'Top products report',
    description: 'Retrieve best-selling products ranked by quantity sold or revenue with optional date range, outlet, and limit filtering. OWNER and ADMIN roles only.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role (OWNER or ADMIN required)' })
  topProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: TopProductsQueryDto,
  ) {
    return this.reportsService.topProducts(user, query);
  }
}
