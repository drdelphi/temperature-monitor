import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async telegramBotToken(): Promise<string> {
    const user = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { telegramBotToken: true },
    });
    return (user?.telegramBotToken || this.config.get<string>('TELEGRAM_BOT_TOKEN') || '').trim();
  }

  async sendSms(to: string, body: string): Promise<boolean> {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM');
    if (!sid || !token || !from || !to) {
      return false;
    }
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const params = new URLSearchParams({ From: from, To: to, Body: body });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });
      if (!res.ok) {
        this.logger.warn(`Twilio ${res.status} ${await res.text()}`);
      }
      return res.ok;
    } catch (err) {
      this.logger.warn(`Twilio error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async sendTelegram(chatId: string, body: string): Promise<boolean> {
    const bot = await this.telegramBotToken();
    if (!bot || !chatId) {
      return false;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: body }),
      });
      if (!res.ok) {
        this.logger.warn(`Telegram ${res.status} ${await res.text()}`);
      }
      return res.ok;
    } catch (err) {
      this.logger.warn(`Telegram error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
