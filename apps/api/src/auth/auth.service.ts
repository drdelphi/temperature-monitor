import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { cookieOptions } from '../common/crypto';
import { publicUser } from '../common/serialize';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  cookieName() {
    return this.config.get<string>('COOKIE_NAME') || 'tm_session';
  }

  private cookieOpts() {
    return cookieOptions(this.config.get<string>('NODE_ENV') === 'production');
  }

  async login(email: string, password: string, res: Response) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email });
    res.cookie(this.cookieName(), token, this.cookieOpts());
    return publicUser(user);
  }

  logout(res: Response) {
    res.clearCookie(this.cookieName(), {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get<string>('NODE_ENV') === 'production',
      path: '/',
    });
    return { ok: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('Choose a different password from the current one.');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(newPassword) },
    });
    return { ok: true };
  }
}
