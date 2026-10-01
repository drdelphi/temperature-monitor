'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { connectionKindsFromLink, connectionLabel, errorMessage } from '@/lib/format';
import { requestLeave } from '@/lib/leave-guard';
import { type LinkState, linkSession, useLinkSession } from '@/lib/link-session';
import { type Device, normalizeDevices } from '@/lib/types';
import { Button, ErrorText } from './ui';

export function AppSidebar({ onLogout }: { onLogout: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
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

  async function connect(kind: 'usb' | 'ble') {
    setErr(null);
    try {
      if (kind === 'usb') await linkSession.connectUsb();
      else await linkSession.connectBle();
      const id = linkSession.deviceId();
      if (id) {
        await load();
        requestLeave(() => router.push(`/devices/${encodeURIComponent(id)}`));
      }
    } catch (e) {
      if ((e as { name?: string }).name === 'NotFoundError') return;
      setErr(errorMessage(e));
    }
  }

  const selectedId = pathname.startsWith('/devices/')
    ? decodeURIComponent(pathname.slice('/devices/'.length)).split('/')[0]?.toUpperCase()
    : null;

  return (
    <aside className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-pip" />
        Temperature monitor
      </Link>

      <div className="sidebar-section">
        <nav className="monitor-nav" aria-label="Monitors">
          {devices.map((d) => (
            <MonitorCard
              key={d.id}
              device={d}
              active={selectedId === d.id}
              link={link}
            />
          ))}
        </nav>
        <div className="sidebar-actions">
          <Button variant="primary" onClick={() => void connect('usb')} disabled={!serialOk}>
            Add USB
          </Button>
          <Button onClick={() => void connect('ble')} disabled={!bleOk}>
            Add Bluetooth
          </Button>
        </div>
        <ErrorText>{err}</ErrorText>
      </div>

      <div className="sidebar-section sidebar-account">
        <nav className="account-nav">
          <Link href="/settings" className={pathname === '/settings' ? 'active' : undefined}>
            Settings
          </Link>
        </nav>
        <Button variant="danger" onClick={onLogout}>
          Sign out
        </Button>
      </div>
    </aside>
  );
}

function MonitorCard({
  device,
  active,
  link,
}: {
  device: Device;
  active: boolean;
  link: LinkState;
}) {
  const kinds = connectionKindsFromLink(device, link);
  return (
    <Link
      href={`/devices/${encodeURIComponent(device.id)}`}
      className={`monitor-item${active ? ' active' : ''}`}
    >
      <span className="monitor-name">{device.name}</span>
      {kinds.length ? (
        <span className="conn-badges">
          {kinds.map((kind) => (
            <span key={kind} className={`conn-badge ${kind}`}>
              {connectionLabel(kind)}
            </span>
          ))}
        </span>
      ) : null}
    </Link>
  );
}
