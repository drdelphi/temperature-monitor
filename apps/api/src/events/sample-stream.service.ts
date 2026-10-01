import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

export type SampleStreamEvent = {
  deviceId: string;
  channel: number;
  ts: string;
  tempC: number | null;
  rOhm: number | null;
  adcRaw: number;
};

@Injectable()
export class SampleStreamService {
  private readonly bus = new Subject<SampleStreamEvent>();

  emit(event: SampleStreamEvent) {
    this.bus.next(event);
  }

  observe(deviceId: string): Observable<SampleStreamEvent> {
    return this.bus.pipe(filter((event) => event.deviceId === deviceId));
  }
}
