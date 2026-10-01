import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { DeviceOrJwtAuthGuard } from '../auth/device-or-jwt.guard';
import { IngestService } from './ingest.service';
import { IngestDto } from './dto/ingest.dto';
import type { AuthRequest } from '../common/auth-request';

@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post()
  @UseGuards(DeviceOrJwtAuthGuard)
  post(@Req() req: AuthRequest, @Body() body: IngestDto) {
    return this.ingest.ingest(req, body);
  }
}
