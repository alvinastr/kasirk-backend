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
    description: 'Start a cashier shift for an outlet with opening cash balance. Only one shift per outlet can be active. Accessible by OWNER, ADMIN, and CASHIER roles.',
  })
  @ApiBadRequestResponse({ description: 'Invalid opening balance or outlet not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
  @ApiForbiddenResponse({ description: 'Insufficient role or tenant mismatch' })
  @ApiConflictResponse({ description: 'Outlet already has an active shift' })
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

  @Post(':id/close')
  @ApiOperation({
    summary: 'Close an active shift',
    description: 'End a shift by recording closing cash balance. Calculates shift summary including total sales and cash variance.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Shift UUID',
  })
  @ApiBadRequestResponse({ description: 'Invalid closing balance or shift already closed' })
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
