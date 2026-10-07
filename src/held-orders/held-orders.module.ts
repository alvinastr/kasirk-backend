import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { HeldOrdersController } from './held-orders.controller';
import { HeldOrdersService } from './held-orders.service';

@Module({
  imports: [PrismaModule, AuthModule, TransactionsModule],
  controllers: [HeldOrdersController],
  providers: [HeldOrdersService],
  exports: [HeldOrdersService],
})
export class HeldOrdersModule {}
