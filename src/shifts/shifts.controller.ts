import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { CloseShiftDto } from './dto/close-shift.dto';
import { OpenShiftDto } from './dto/open-shift.dto';
import { ShiftsService } from './shifts.service';

@ApiTags('Shifts')
@Controller('shifts')
@UseGuards(JwtGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'CASHIER')
@ApiBearerAuth('JWT')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post('open')
  @ApiOperation({
    summary: 'Open a new shift',
    description: 'Start a cashier shift for an outlet. Only one shift per tenant/user can be active.',
  })
  @ApiBadRequestResponse({ description: 'Invalid outlet or request body' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role, tenant mismatch, or outlet access denied' })
  @ApiConflictResponse({ description: 'User already has an active shift' })
  open(@CurrentUser() user: JwtPayload, @Body() dto: OpenShiftDto) {
    return this.shiftsService.open(user, dto);
  }

  @Get('current')
  @ApiOperation({
    summary: 'Get current active shift',
    description: 'Retrieve the authenticated user\'s currently active shift, if any.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Tenant mismatch' })
  @ApiNotFoundResponse({ description: 'No active shift found for this user' })
  current(@CurrentUser() user: JwtPayload) {
    return this.shiftsService.current(user);
  }

  @Get(':id/summary')
  @ApiOperation({ summary: 'Get a shift sales summary' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid', description: 'Shift UUID' })
  summary(@CurrentUser() user: JwtPayload, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.shiftsService.summary(user, id);
  }

  @Post(':id/close')
  @ApiOperation({
    summary: 'Close an active shift',
    description: 'End a shift with an empty V1 body. The server derives the final summary from persisted sales; no cash reconciliation or variance is accepted.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Shift UUID',
  })
  @ApiBadRequestResponse({ description: 'Invalid close request body' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role or tenant mismatch' })
  @ApiNotFoundResponse({ description: 'Shift not found' })
  close(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CloseShiftDto,
  ) {
    return this.shiftsService.close(user, id, dto);
  }
}
