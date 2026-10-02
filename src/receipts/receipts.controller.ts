import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ReceiptsService } from './receipts.service';

@ApiTags('Receipts')
@Controller('receipts')
@UseGuards(JwtGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'CASHIER')
@ApiBearerAuth('JWT')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get(':transaction_id')
  @ApiOperation({
    summary: 'Get receipt by transaction ID',
    description: 'Retrieve printable receipt data for a completed transaction. Accessible by OWNER, ADMIN, and CASHIER roles.',
  })
  @ApiParam({
    name: 'transaction_id',
    type: 'string',
    format: 'uuid',
    description: 'Transaction UUID',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role or tenant mismatch' })
  @ApiNotFoundResponse({ description: 'Transaction not found' })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('transaction_id', new ParseUUIDPipe()) transactionId: string,
  ) {
    return this.receiptsService.findOne(user, transactionId);
  }
}
