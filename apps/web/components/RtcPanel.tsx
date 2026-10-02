'use client';

import { useEffect, useState } from 'react';
import { apiSend } from '@/lib/api';
import { errorMessage, localInputToUnix, toLocalInput, unixToLocalInput } from '@/lib/format';
import { linkSession } from '@/lib/link-session';
import type { Device } from '@/lib/types';
import { Button, Field } from './ui';

export function RtcPanel({ device, onChange }: { device: Device; onChange: () => Promise<void> | void }) {
  const [manual, setManual] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setManual(toLocalInput(new Date()));
  }, []);

  useEffect(() => {
    if (device.pendingUnixTime != null) {
      setManual(unixToLocalInput(device.pendingUnixTime));
    }
  }, [device.pendingUnixTime]);

  useEffect(() => {
    if (device.pendingUnixTime == null || !linkSession.matchesDevice(device.id)) return;
    let cancelled = false;
    void (async () => {
      try {
        const pushed = await linkSession.pushTime(device.id, device.pendingUnixTime!);
        if (!pushed || cancelled) return;
        await apiSend(`/v1/devices/${encodeURIComponent(device.id)}`, 'PATCH', { pendingUnixTime: null });
        if (!cancelled) await onChange();
      } catch {
        /* Leave the queued time for the next check-in. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [device.id, device.pendingUnixTime, onChange]);

  async function apply(unixTime: number) {
    setBusy(true);
    setErr(null);
    try {
      await apiSend(`/v1/devices/${encodeURIComponent(device.id)}`, 'PATCH', { pendingUnixTime: unixTime });
      const pushed = await linkSession.pushTime(device.id, unixTime);
      if (pushed) {
        await apiSend(`/v1/devices/${encodeURIComponent(device.id)}`, 'PATCH', { pendingUnixTime: null });
      }
      await onChange();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section">
      <h2>Clock</h2>
      <div className="card card-pad form-card stack">
        <div className="row">
          <Field label="Date and time">
            <input
              type="datetime-local"
              step={1}
              value={manual}
              suppressHydrationWarning
              onChange={(e) => setManual(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void apply(Math.floor(Date.now() / 1000))}
          >
            Use this computer’s time
          </Button>
        </div>
        <div className="row">
          <Button disabled={busy || !manual} onClick={() => void apply(localInputToUnix(manual))}>
            Set clock
          </Button>
        </div>
        {device.pendingUnixTime != null ? (
          <p className="hint">
            Saved. The monitor will set this time the next time it checks in over Wi-Fi.
          </p>
        ) : null}
        {err ? <div className="err">{err}</div> : null}
      </div>
    </div>
  );
}
