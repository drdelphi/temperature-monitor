import { Global, Module } from '@nestjs/common';
import { SampleStreamService } from './sample-stream.service';

@Global()
@Module({
  providers: [SampleStreamService],
  exports: [SampleStreamService],
})
export class EventsModule {}
