import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  Max,
  Min,
} from 'class-validator';

export class UpsertAlarmDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(7)
  channel!: number;

  @IsIn(['below', 'above'])
  kind!: 'below' | 'above';

  @Type(() => Number)
  @IsNumber()
  thresholdC!: number;

  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsNumber()
  hysteresis!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  cooldownSec!: number;

  @IsBoolean()
  notifySms!: boolean;

  @IsBoolean()
  notifyTelegram!: boolean;
}
