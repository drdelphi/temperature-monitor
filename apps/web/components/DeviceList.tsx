'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { channelHue } from '@/lib/colors';
import { errorMessage, formatMac, lastSeenAge, transportLabel } from '@/lib/format';
import { linkSession, useLinkSession } from '@/lib/link-session';
import { type Device, normalizeDevices } from '@/lib/types';
import { Button, ErrorText } from './ui';

export function DeviceList() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [serialOk, setSerialOk] = useState(true);
  const [bleOk, setBleOk] = useState(true);
  const link = useLinkSession();

  const load = useCallback(async () => {
    try {
      const list = normalizeDevices(await apiGet('/v1/devices'));
      setDevices(list);
      setErr(null);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    setSerialOk(typeof navigator !== 'undefined' && Boolean(navigator.serial));
    setBleOk(typeof navigator !== 'undefined' && Boolean(navigator.bluetooth));
  }, []);

  useEffect(() => {
    if (link.deviceId) void load();
  }, [link.deviceId, link.claimed, load]);

  async function connectUsb() {
    setErr(null);
    try {
      await linkSession.connectUsb();
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFoundError') return;
      setErr(errorMessage(e));
    }
  }

  async function connectBle() {
    setErr(null);
    try {
      await linkSession.connectBle();
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFoundError') return;
      setErr(errorMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Monitors</h1>
          <p className="sub">Connect a monitor over USB or Bluetooth, then open it to see temperatures.</p>
        </div>
      </div>
      <div className="toolbar">
        <Button variant="primary" onClick={() => void connectUsb()} disabled={!serialOk}>
          Connect USB
        </Button>
        <Button onClick={() => void connectBle()} disabled={!bleOk}>
          Connect Bluetooth
        </Button>
        {link.open ? (
          <Button variant="ghost" onClick={() => void linkSession.disconnectByUser()}>
            Disconnect
          </Button>
        ) : null}
        <span className="status-line">
          Connection: <strong>{link.status}</strong>
          {link.transport ? ` · ${transportLabel(link.transport)}` : ''}
          {link.deviceId ? ` · ${formatMac(link.deviceId)}` : ''}
        </span>
      </div>
      {!serialOk ? (
        <p className="warn-text">USB connections work in Chrome or Edge.</p>
      ) : (
        <p className="hint">
          When asked, choose this monitor’s USB connection. If the same name appears more than
          once, pick any — they are the same monitor. After that, this page reconnects over USB
          when you reload. You can set up Wi-Fi from the <Link href="/wifi">Wi-Fi</Link> page.
        </p>
      )}
      <ErrorText>{err}</ErrorText>
      {devices.length === 0 ? (
        <div className="empty">No monitors yet. Connect one over USB or Bluetooth to add it.</div>
      ) : (
        <div className="grid-cards">
          {devices.map((d) => (
            <DeviceCard key={d.id} device={d} linked={link.deviceId === d.id} />
          ))}
        </div>
      )}
    </>
  );
}

function DeviceCard({ device, linked }: { device: Device; linked: boolean }) {
  const age = lastSeenAge(device.lastSeen);
  return (
    <Link href={`/devices/${encodeURIComponent(device.id)}`} className="card device-card">
      <h2>{device.name}</h2>
      <div className="meta">
        <span className="mac">{formatMac(device.id)}</span>
        <span>
          <span className={`dot ${age.tone}`} />
          {age.label}
        </span>
        {linked ? <span className="linked-badge">Connected here</span> : null}
      </div>
      <div className="ch-tags">
        {device.channels.map((ch) => (
          <span
            key={ch.index}
            className={`ch-tag${ch.enabled ? ' on' : ''}`}
            style={{ borderColor: ch.enabled ? channelHue(ch.index) : undefined }}
          >
            {ch.name}
          </span>
        ))}
      </div>
    </Link>
  );
}
