import { Body, Controller, Headers, Post } from '@nestjs/common';
import { TelegramService, type TelegramUpdate } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Post('webhook')
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() body: TelegramUpdate,
  ) {
    this.telegram.assertWebhookSecret(secret);
    await this.telegram.handleUpdate(body ?? { update_id: 0 });
    return { ok: true };
  }
}
