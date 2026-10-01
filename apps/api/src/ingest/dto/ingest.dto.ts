import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class IngestSnapshotDto {
  @IsOptional()
  @IsString()
  ts?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(8)
  @ArrayMaxSize(8)
  @IsInt({ each: true })
  adc?: number[];

  @IsOptional()
  @IsString()
  packed?: string;
}

export class IngestDto {
  @IsOptional()
  @IsString()
  deviceId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestSnapshotDto)
  snapshots!: IngestSnapshotDto[];
}
