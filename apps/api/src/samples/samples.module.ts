import { Module } from '@nestjs/common';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';
import { SampleWsService } from './sample-ws.service';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [AuthModule, DevicesModule, EventsModule],
  controllers: [SamplesController],
  providers: [SamplesService, SampleWsService],
})
export class SamplesModule {}
