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
import { JwtGuard } from '../auth/jwt.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { TransactionsService } from './transactions.service';

@Controller('transactions')
@UseGuards(JwtGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class TransactionsController {
    constructor(private readonly transactionsService: TransactionsService) {}

    @Post()
    create(@CurrentUser() user: JwtPayload, @Body() dto: CreateTransactionDto) {
        return this.transactionsService.create(user, dto);
    }

    @Get()
    findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryTransactionsDto) {
        return this.transactionsService.findAll(user, query);
    }

    @Get(':id')
    findOne(@CurrentUser() user: JwtPayload, @Param('id', new ParseUUIDPipe()) id: string) {
        return this.transactionsService.findOne(user, id);
    }
}
