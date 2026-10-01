import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

export class PatchDeviceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? null : Number(value)))
  @ValidateIf((_, v) => v != null)
  @IsInt()
  @Min(0)
  pendingUnixTime?: number | null;
}
