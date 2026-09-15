import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { SyncTransactionsDto } from './dto/sync-transactions.dto';
import { SyncService } from './sync.service';

@Controller('sync')
@UseGuards(JwtGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('transactions')
  @Roles('OWNER', 'ADMIN', 'CASHIER')
  syncTransactions(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SyncTransactionsDto,
  ) {
    return this.syncService.transactions(user, dto);
  }
}
