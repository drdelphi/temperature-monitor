import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { AuthModule } from '../auth/auth.module';
import { AlarmsModule } from '../alarms/alarms.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [AuthModule, AlarmsModule, EventsModule],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
