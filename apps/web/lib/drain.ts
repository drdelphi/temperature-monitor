import { DRAIN_POLL_MS, DRAIN_RETRY_MS } from './config';
import type { HostToDevice, IngestResponse } from './types';

export type FlushAck = Extract<HostToDevice, { type: 'flush_ack' }>;

/**
 * The device may erase flash up to this timestamp only after the API saved it.
 * Missing ackedTs means keep every stored record.
 */
export function flushAckFromIngest(res: IngestResponse | null | undefined): FlushAck | null {
  const ts = res?.ackedTs;
  if (typeof ts !== 'string' || ts.length === 0) return null;
  return { type: 'flush_ack', ts };
}

export function drainRetryMs(failed: boolean): number {
  return failed ? DRAIN_RETRY_MS : DRAIN_POLL_MS;
}
