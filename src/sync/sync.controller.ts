import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { SyncTransactionsDto } from './dto/sync-transactions.dto';
import { SyncService } from './sync.service';

@ApiTags('Sync')
@Controller('sync')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
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
  @ApiOperation({
    summary: 'Sync offline transactions',
    description: 'Batch upload transactions created offline by mobile clients. Deduplicates by client transaction ID and reconciles with existing server records. OWNER, ADMIN, and CASHIER roles.',
  })
  @ApiBadRequestResponse({ description: 'Invalid transaction data or insufficient stock' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role or tenant mismatch' })
  @ApiConflictResponse({ description: 'Conflicting transaction state detected' })
  syncTransactions(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SyncTransactionsDto,
  ) {
    return this.syncService.transactions(user, dto);
  }
}
