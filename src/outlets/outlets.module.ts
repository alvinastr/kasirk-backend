import { Module } from '@nestjs/common';
import { OutletsController } from './outlets.controller';
import { OutletsService } from './outlets.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ReceiptSettingsController } from './receipt-settings.controller';
import { ReceiptSettingsService } from './receipt-settings.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [OutletsController, ReceiptSettingsController],
  providers: [OutletsService, ReceiptSettingsService],
})
export class OutletsModule {}
