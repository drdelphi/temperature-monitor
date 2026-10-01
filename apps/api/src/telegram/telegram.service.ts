import { Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotifyService } from '../notify/notify.service';
import { PrismaService } from '../prisma/prisma.service';

type TelegramChat = { id: number };
type TelegramMessage = { chat: TelegramChat; text?: string };
export type TelegramUpdate = { update_id: number; message?: TelegramMessage };

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private running = false;
  private pollTask: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly notify: NotifyService,
    private readonly prisma: PrismaService,
  ) {}

  async resolveToken() {
    const user = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { telegramBotToken: true },
    });
    return (user?.telegramBotToken || this.config.get<string>('TELEGRAM_BOT_TOKEN') || '').trim();
  }

  token() {
    return (this.config.get<string>('TELEGRAM_BOT_TOKEN') || '').trim();
  }

  webhookSecret() {
    return (this.config.get<string>('TELEGRAM_WEBHOOK_SECRET') || '').trim();
  }

  async onModuleInit() {
    await this.startListener();
  }

  async reload() {
    await this.stopListener();
    await this.startListener();
  }

  private async startListener() {
    const token = await this.resolveToken();
    if (!token) {
      return;
    }
    const secret = this.webhookSecret();
    const publicUrl = (this.config.get<string>('PUBLIC_API_URL') || '').replace(/\/$/, '');
    if (secret) {
      await this.setWebhook(`${publicUrl}/v1/telegram/webhook`, secret, token);
      return;
    }
    await this.deleteWebhook(token);
    this.running = true;
    this.pollTask = this.pollLoop(token);
  }

  private async stopListener() {
    this.running = false;
    if (this.pollTask) {
      await this.pollTask.catch(() => undefined);
      this.pollTask = null;
    }
  }

  async onModuleDestroy() {
    await this.stopListener();
  }

  assertWebhookSecret(header: string | string[] | undefined) {
    const secret = this.webhookSecret();
    if (!secret) {
      return;
    }
    const value = Array.isArray(header) ? header[0] : header;
    if (value !== secret) {
      throw new UnauthorizedException('Invalid telegram webhook secret');
    }
  }

  async handleUpdate(update: TelegramUpdate) {
    const text = (update.message?.text || '').trim();
    const chatId = update.message?.chat?.id;
    if (chatId == null) {
      return;
    }
    const command = text.split(/\s+/)[0]?.split('@')[0];
    if (command === '/start') {
      await this.notify.sendTelegram(
        String(chatId),
        `Your Telegram number is ${chatId}. Paste it in Settings so you can receive temperature alerts.`,
      );
    }
  }

  private async setWebhook(url: string, secret: string, token = this.token()) {
    if (!token || !url.startsWith('http')) {
      this.logger.warn('Skipping Telegram setWebhook; PUBLIC_API_URL missing');
      return;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, secret_token: secret }),
      });
      if (!res.ok) {
        this.logger.warn(`setWebhook ${res.status} ${await res.text()}`);
      } else {
        this.logger.log(`Telegram webhook set to ${url}`);
      }
    } catch (err) {
      this.logger.warn(`setWebhook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async deleteWebhook(token = this.token()) {
    if (!token) {
      return;
    }
    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: 'POST' });
    } catch (err) {
      this.logger.warn(`deleteWebhook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async pollLoop(token: string) {
    this.logger.log('Telegram getUpdates long-poll started');
    let offset = 0;
    while (this.running) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`,
        );
        if (!res.ok) {
          this.logger.warn(`getUpdates ${res.status}`);
          await this.sleep(3000);
          continue;
        }
        const body = (await res.json()) as { ok?: boolean; result?: TelegramUpdate[] };
        const updates = body.result ?? [];
        for (const update of updates) {
          await this.handleUpdate(update);
          offset = update.update_id + 1;
        }
      } catch (err) {
        this.logger.warn(`getUpdates error: ${err instanceof Error ? err.message : String(err)}`);
        await this.sleep(3000);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
