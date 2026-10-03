import { Module } from '@nestjs/common';
import { ModifierGroupsController } from './modifier-groups.controller';
import { ModifierGroupsService } from './modifier-groups.service';

@Module({
  controllers: [ModifierGroupsController],
  providers: [ModifierGroupsService],
})
export class ModifierGroupsModule {}
