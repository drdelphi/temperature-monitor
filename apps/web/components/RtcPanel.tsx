'use client';

import { useEffect, useState } from 'react';
import { apiSend } from '@/lib/api';
import { errorMessage, localInputToUnix, toLocalInput, unixToLocalInput } from '@/lib/format';
import { linkSession } from '@/lib/link-session';
import type { Device } from '@/lib/types';
import { Button, Field } from './ui';

export function RtcPanel({ device, onChange }: { device: Device; onChange: () => Promise<void> | void }) {
  const [manual, setManual] = useState(() => toLocalInput(new Date()));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (device.pendingUnixTime != null) {
      setManual(unixToLocalInput(device.pendingUnixTime));
    }
  }, [device.pendingUnixTime]);

  async function apply(unixTime: number) {
    setBusy(true);
    setErr(null);
    try {
      await apiSend(`/v1/devices/${encodeURIComponent(device.id)}`, 'PATCH', { pendingUnixTime: unixTime });
      await linkSession.pushTime(device.id, unixTime);
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
      <div className="card card-pad">
        <div className="row">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void apply(Math.floor(Date.now() / 1000))}
          >
            Use this computer’s time
          </Button>
          <Field label="Date and time">
            <input type="datetime-local" step={1} value={manual} onChange={(e) => setManual(e.target.value)} />
          </Field>
          <Button disabled={busy || !manual} onClick={() => void apply(localInputToUnix(manual))}>
            Set clock
          </Button>
        </div>
        {device.pendingUnixTime != null ? (
          <p className="hint mt">Waiting to update the monitor’s clock.</p>
        ) : null}
        {err ? <div className="err">{err}</div> : null}
      </div>
    </div>
  );
}
