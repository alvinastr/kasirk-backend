import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { OutletsModule } from './outlets/outlets.module';
import { UsersModule } from './users/users.module';
import { StockController } from './stock/stock.controller';
import { StockModule } from './stock/stock.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ReportsModule } from './reports/reports.module';
import { CustomersModule } from './customers/customers.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { ShiftsModule } from './shifts/shifts.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    PrismaModule,

    AuthModule,

    ProductsModule,

    CategoriesModule,

    OutletsModule,

    UsersModule,

    StockModule,

    TransactionsModule,

    ReportsModule,

    CustomersModule,

    ReceiptsModule,

    ShiftsModule,

    SyncModule,
  ],
  controllers: [
    AppController,
  ],
  providers: [
    AppService,
  ],
})
export class AppModule {}
