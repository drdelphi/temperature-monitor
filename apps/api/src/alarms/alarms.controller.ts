import { Body, Controller, Get, Param, ParseArrayPipe, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlarmsService } from './alarms.service';
import { UpsertAlarmDto } from './dto/upsert-alarm.dto';

@Controller('devices/:id/alarms')
@UseGuards(JwtAuthGuard)
export class AlarmsController {
  constructor(private readonly alarms: AlarmsService) {}

  @Get()
  list(@Param('id') id: string) {
    return this.alarms.list(id);
  }

  @Put()
  put(
    @Param('id') id: string,
    @Body(new ParseArrayPipe({ items: UpsertAlarmDto })) body: UpsertAlarmDto[],
  ) {
    return this.alarms.replaceOrUpsert(id, body);
  }
}
