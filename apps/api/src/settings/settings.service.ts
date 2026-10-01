import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicUser } from '../common/serialize';
import type { PatchSettingsDto } from './dto/patch-settings.dto';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  get(user: User) {
    return publicUser(user);
  }

  async patch(user: User, dto: PatchSettingsDto) {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ...(dto.phoneE164 !== undefined ? { phoneE164: dto.phoneE164 } : {}),
        ...(dto.telegramChatId !== undefined ? { telegramChatId: dto.telegramChatId } : {}),
        ...(dto.telegramBotToken !== undefined
          ? { telegramBotToken: dto.telegramBotToken?.trim() || null }
          : {}),
      },
    });
    if (dto.telegramBotToken !== undefined) {
      await this.telegram.reload().catch(() => undefined);
    }
    return publicUser(updated);
  }

  async requireUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Your account was not found.');
    }
    return user;
  }
}
