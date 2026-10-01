import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Observable, firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { hashDeviceToken, verifyDeviceToken } from '../common/crypto';
import type { AuthRequest } from '../common/auth-request';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class DeviceOrJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtAuthGuard,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      const token = header.slice(7).trim();
      if (!token) {
        throw new UnauthorizedException('This monitor is not authorized.');
      }
      const tokenHash = hashDeviceToken(token);
      let device = await this.prisma.device.findFirst({ where: { tokenHash } });
      if (!device) {
        const candidates = await this.prisma.device.findMany({
          where: { tokenHash: { startsWith: '$argon2' } },
        });
        for (const row of candidates) {
          if (await verifyDeviceToken(token, row.tokenHash)) {
            device = row;
            break;
          }
        }
      }
      if (!device) {
        throw new UnauthorizedException('This monitor is not authorized.');
      }
      req.device = device;
      req.authKind = 'device';
      return true;
    }

    const result = this.jwtGuard.canActivate(context);
    const ok = await this.resolve(result);
    if (!ok) {
      return false;
    }
    req.authKind = 'operator';
    return true;
  }

  private async resolve(result: boolean | Promise<boolean> | Observable<boolean>): Promise<boolean> {
    if (typeof result === 'boolean') {
      return result;
    }
    if (typeof (result as Promise<boolean>).then === 'function') {
      return result as Promise<boolean>;
    }
    return firstValueFrom(result as Observable<boolean>);
  }
}
