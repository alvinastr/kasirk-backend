import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReplaceProductModifierGroupItemDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Modifier group UUID to assign to the product.',
  })
  @IsUUID()
  modifier_group_id: string;

  @ApiProperty({
    type: Boolean,
    description: 'Whether this modifier group is required for this product.',
  })
  @IsBoolean()
  required: boolean;

  @ApiProperty({
    enum: ['SINGLE', 'MULTIPLE'],
    description: 'Allowed selection mode for this product/group assignment.',
  })
  @IsIn(['SINGLE', 'MULTIPLE'])
  selection_type: 'SINGLE' | 'MULTIPLE';

  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Display order for product UI. Lower values appear first.',
  })
  @IsInt()
  @Min(0)
  display_order: number;
}

export class ReplaceProductModifierGroupsDto {
  @ApiProperty({
    type: () => [ReplaceProductModifierGroupItemDto],
    description: 'Complete replacement set for product modifier group assignments.',
  })
  @IsArray()
  @ArrayUnique((item: ReplaceProductModifierGroupItemDto | null) =>
    typeof item?.modifier_group_id === 'string'
      ? item.modifier_group_id.toLowerCase()
      : undefined,
  )
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => ReplaceProductModifierGroupItemDto)
  modifier_groups: ReplaceProductModifierGroupItemDto[];
}
