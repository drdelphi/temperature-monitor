import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SamplesService } from './samples.service';

@Controller()
export class SamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get('samples/count')
  @UseGuards(JwtAuthGuard)
  count(
    @Query('deviceId') deviceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channel') channel?: string,
  ) {
    return this.samples.count({ deviceId, from, to, channel });
  }

  @Get('samples')
  @UseGuards(JwtAuthGuard)
  list(
    @Query('deviceId') deviceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channel') channel?: string,
    @Query('downsample') downsample?: string,
  ) {
    return this.samples.list({ deviceId, from, to, channel, downsample });
  }
}
