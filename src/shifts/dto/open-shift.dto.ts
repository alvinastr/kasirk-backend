import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OpenShiftDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Outlet identifier.',
  })
  @IsUUID()
  outlet_id!: string;
}
