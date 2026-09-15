import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ReceiptsService } from './receipts.service';

@Controller('receipts')
@UseGuards(JwtGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'CASHIER')
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get(':transaction_id')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('transaction_id', new ParseUUIDPipe()) transactionId: string,
  ) {
    return this.receiptsService.findOne(user, transactionId);
  }
}
