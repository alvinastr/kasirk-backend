import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';


@Module({

    imports:[
        PrismaModule,
        AuthModule
    ],

    controllers:[
        StockController
    ],

    providers:[
        StockService
    ]

})

export class StockModule {}