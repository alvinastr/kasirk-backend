import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductionBootstrapService } from './production-bootstrap.service';

@Module({
  imports: [PrismaModule],
  providers: [ProductionBootstrapService],
})
export class ProductionBootstrapModule {}
