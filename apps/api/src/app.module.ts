import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { DevicesModule } from './devices/devices.module';
import { IngestModule } from './ingest/ingest.module';
import { SamplesModule } from './samples/samples.module';
import { AlarmsModule } from './alarms/alarms.module';
import { SettingsModule } from './settings/settings.module';
import { TelegramModule } from './telegram/telegram.module';
import { NotifyModule } from './notify/notify.module';
import { EventsModule } from './events/events.module';
import { ExcelModule } from './excel/excel.module';
import { OwnerSeedService } from './owner-seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    NotifyModule,
    EventsModule,
    AuthModule,
    DevicesModule,
    IngestModule,
    SamplesModule,
    AlarmsModule,
    SettingsModule,
    TelegramModule,
    ExcelModule,
  ],
  providers: [OwnerSeedService],
})
export class AppModule {}
