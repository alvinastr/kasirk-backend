import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
import { ReceiptSettingsResponseDto } from './dto/receipt-settings-response.dto';
import { UpdateReceiptSettingsDto } from './dto/update-receipt-settings.dto';
import { ReceiptSettingsService } from './receipt-settings.service';

@ApiTags('Outlets')
@ApiBearerAuth('JWT')
@Controller('outlets/:outletId/receipt-settings')
@UseGuards(JwtGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ReceiptSettingsController {
  constructor(
    private readonly receiptSettingsService: ReceiptSettingsService,
  ) {}

  @Get()
  @Roles('OWNER', 'ADMIN', 'CASHIER')
  @ApiOperation({
    summary: 'Get effective outlet receipt settings',
    description:
      'Returns stored settings or synthesized tenant/outlet defaults without creating a row.',
  })
  @ApiParam({ name: 'outletId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: ReceiptSettingsResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Role or outlet access denied' })
  @ApiNotFoundResponse({ description: 'Outlet not found in tenant' })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('outletId', new ParseUUIDPipe()) outletId: string,
  ) {
    return this.receiptSettingsService.get(user, outletId);
  }

  @Put()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({
    summary: 'Fully replace outlet receipt settings',
    description:
      'Atomically creates or replaces every editable setting. All request fields are required; tenant and template version are server-controlled.',
  })
  @ApiParam({ name: 'outletId', type: String, format: 'uuid' })
  @ApiOkResponse({ type: ReceiptSettingsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid outlet ID or settings' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'OWNER or ADMIN role required' })
  @ApiNotFoundResponse({ description: 'Outlet not found in tenant' })
  put(
    @CurrentUser() user: JwtPayload,
    @Param('outletId', new ParseUUIDPipe()) outletId: string,
    @Body() dto: UpdateReceiptSettingsDto,
  ) {
    return this.receiptSettingsService.put(user, outletId, dto);
  }
}
