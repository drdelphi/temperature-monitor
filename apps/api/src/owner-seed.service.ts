import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class OwnerSeedService implements OnModuleInit {
  private readonly logger = new Logger(OwnerSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const email = this.config.get<string>('OWNER_EMAIL');
    const password = this.config.get<string>('OWNER_PASSWORD');
    if (!email || !password) {
      this.logger.warn('OWNER_EMAIL / OWNER_PASSWORD unset; skipping operator seed');
      return;
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return;
    }

    await this.prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password),
      },
    });
    this.logger.log(`Seeded operator ${email}`);
  }
}
