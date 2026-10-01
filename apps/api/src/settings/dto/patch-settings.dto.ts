import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class PatchSettingsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  phoneE164?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  telegramChatId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  telegramBotToken?: string | null;
}
