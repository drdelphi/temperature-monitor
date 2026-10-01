import { IsOptional, IsString, Matches } from 'class-validator';

export class ClaimDeviceDto {
  @IsString()
  @Matches(/^[0-9A-Fa-f:\-]{12,17}$/)
  deviceId!: string;

  @IsOptional()
  @IsString()
  name?: string;
}
