import {
    Body,
    Controller,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
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
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { TransactionsService } from './transactions.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@ApiTags('Transactions')
@Controller('transactions')
@UseGuards(JwtGuard, RolesGuard)
@ApiBearerAuth('JWT')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class TransactionsController {
    constructor(private readonly transactionsService: TransactionsService) {}

    @Post()
    @Roles('OWNER', 'ADMIN', 'CASHIER')
    @ApiOperation({
        summary: 'Create a new transaction',
        description: 'Record a completed sale transaction with items, payment, and optional customer. Validates stock availability and shift state. Accessible by OWNER, ADMIN, and CASHIER roles.',
    })
    @ApiBadRequestResponse({ description: 'Invalid transaction data or insufficient stock' })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
    @ApiForbiddenResponse({ description: 'Insufficient role or no active shift' })
    @ApiConflictResponse({ description: 'Duplicate client transaction ID' })
    create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTransactionDto) {
        return this.transactionsService.create(user, dto);
    }

    @Get()
    @ApiOperation({
        summary: 'List transactions',
        description: 'Retrieve paginated transaction history with optional filters by outlet, date range, and payment method. Returns transactions within the user\'s tenant scope.',
    })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
    @ApiForbiddenResponse({ description: 'Tenant mismatch' })
    findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryTransactionsDto) {
        return this.transactionsService.findAll(user, query);
    }

    @Get(':id')
    @ApiOperation({
        summary: 'Get transaction by ID',
        description: 'Retrieve full transaction details including items, payment, customer, and shift information.',
    })
    @ApiParam({
        name: 'id',
        type: 'string',
        format: 'uuid',
        description: 'Transaction UUID',
    })
    @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token' })
    @ApiForbiddenResponse({ description: 'Tenant mismatch' })
    @ApiNotFoundResponse({ description: 'Transaction not found' })
    findOne(@CurrentUser() user: JwtPayload, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.transactionsService.findOne(user, id);
    }
}
