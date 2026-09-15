import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
    imports: [PrismaModule, AuthModule],
    controllers: [TransactionsController],
    providers: [TransactionsService],
})
export class TransactionsModule {}
