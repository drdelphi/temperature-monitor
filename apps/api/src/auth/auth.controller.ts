import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { publicUser } from '../common/serialize';
import type { AuthRequest } from '../common/auth-request';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body.email, body.password, res);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    return this.auth.logout(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: AuthRequest) {
    if (!req.user) {
      return { email: '', phoneE164: null, telegramChatId: null, telegramBotTokenSet: false };
    }
    return publicUser(req.user);
  }

  @Post('password')
  @UseGuards(JwtAuthGuard)
  changePassword(@Req() req: AuthRequest, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(req.user!.id, body.currentPassword, body.newPassword);
  }
}
