import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';
import { PatchSettingsDto } from './dto/patch-settings.dto';
import type { AuthRequest } from '../common/auth-request';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() req: AuthRequest) {
    return this.settings.get(req.user!);
  }

  @Patch()
  patch(@Req() req: AuthRequest, @Body() body: PatchSettingsDto) {
    return this.settings.patch(req.user!, body);
  }
}
