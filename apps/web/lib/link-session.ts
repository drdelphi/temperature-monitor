'use client';

import { useEffect, useState } from 'react';
import { ApiError, apiGet, apiSend } from './api';
import {
  API_BASE,
  BLE_NAME_PREFIX,
  DRAIN_LIMIT,
  NUS_RX,
  NUS_SERVICE,
  NUS_TX,
  USB_BAUD,
  USB_BUFFER,
  USB_ESP_PID,
  USB_ESP_VID,
} from './config';
import { drainRetryMs, flushAckFromIngest } from './drain';
import { errorMessage, explainUsbOpenError } from './format';
import { autoUsbEnabled, setAutoUsb } from './usb-auto';
import {
  type ClaimResponse,
  type DeviceMsg,
  type HelloMsg,
  type HostToDevice,
  type IngestSnapshot,
  type StatusMsg,
  type WifiNetwork,
  type WifiScanMsg,
  type WifiState,
  normalizeClaim,
  normalizeConfig,
  normalizeIngest,
  normalizeWifiScan,
  parseDeviceLine,
  protocolChannels,
  shouldDrain,
} from './types';

export type TransportKind = 'usb' | 'ble';

export type LinkState = {
  transport: TransportKind | null;
  open: boolean;
  deviceId: string | null;
  wifiState: WifiState | null;
  claimed: boolean | null;
  status: string;
  forwarding: number;
  wifiSsid: string | null;
  wifiIp: string | null;
  wifiGateway: string | null;
  wifiNetmask: string | null;
  wifiDns: string | null;
  wifiRssi: number | null;
  wifiInternet: boolean | null;
  wifiConnecting: boolean;
  error: string | null;
};

const IDLE: LinkState = {
  transport: null,
  open: false,
  deviceId: null,
  wifiState: null,
  claimed: null,
  status: 'Not connected',
  forwarding: 0,
  wifiSsid: null,
  wifiIp: null,
  wifiGateway: null,
  wifiNetmask: null,
  wifiDns: null,
  wifiRssi: null,
  wifiInternet: null,
  wifiConnecting: false,
  error: null,
};

type Listener = (state: LinkState) => void;

function isHello(msg: DeviceMsg): msg is HelloMsg {
  return msg.type === 'hello' && typeof (msg as HelloMsg).deviceId === 'string';
}

function isStatus(msg: DeviceMsg): msg is StatusMsg {
  return msg.type === 'status';
}

function isWifiScan(msg: DeviceMsg): msg is WifiScanMsg {
  return msg.type === 'wifi_scan';
}

function wifiNetFromMsg(msg: DeviceMsg): Partial<LinkState> {
  const rec = msg as unknown as Record<string, unknown>;
  const out: Partial<LinkState> = {};
  if (typeof rec.wifiState === 'string') out.wifiState = rec.wifiState as WifiState;
  if (typeof rec.ssid === 'string') out.wifiSsid = rec.ssid || null;
  if (typeof rec.ip === 'string') out.wifiIp = rec.ip || null;
  if (typeof rec.gateway === 'string') out.wifiGateway = rec.gateway || null;
  if (typeof rec.netmask === 'string') out.wifiNetmask = rec.netmask || null;
  if (typeof rec.dns === 'string') out.wifiDns = rec.dns || null;
  if (typeof rec.rssi === 'number' && Number.isFinite(rec.rssi)) out.wifiRssi = rec.rssi;
  if (typeof rec.internet === 'boolean') out.wifiInternet = rec.internet;
  if (typeof rec.wifiConnecting === 'boolean') out.wifiConnecting = rec.wifiConnecting;
  return out;
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
}

class LineAssembler {
  private buf = '';
  private decoder = new TextDecoder();

  pushBytes(bytes: Uint8Array, onLine: (line: string) => void) {
    this.buf += this.decoder.decode(bytes, { stream: true });
    this.flush(onLine);
  }

  pushText(text: string, onLine: (line: string) => void) {
    this.buf += text;
    this.flush(onLine);
  }

  private flush(onLine: (line: string) => void) {
    this.buf = this.buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let idx = this.buf.indexOf('\n');
    while (idx >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.trim()) onLine(line);
      idx = this.buf.indexOf('\n');
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeSerialPort(port: SerialPort): Promise<void> {
  try {
    if (port.readable) {
      const reader = port.readable.getReader();
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
  } catch {
    /* stream already locked or closed */
  }
  try {
    if (port.writable) {
      const writer = port.writable.getWriter();
      try {
        await writer.abort();
      } finally {
        writer.releaseLock();
      }
    }
  } catch {
    /* stream already locked or closed */
  }
  try {
    await port.close();
  } catch {
    /* not open */
  }
}

const USB_FILTERS = [{ usbVendorId: USB_ESP_VID, usbProductId: USB_ESP_PID }];

function isEspPort(port: SerialPort): boolean {
  try {
    const info = port.getInfo();
    if (info.usbVendorId !== USB_ESP_VID) return false;
    if (info.usbProductId != null && info.usbProductId !== USB_ESP_PID) return false;
    return true;
  } catch {
    return false;
  }
}

async function grantedEspPorts(): Promise<SerialPort[]> {
  const serial = navigator.serial;
  if (!serial) return [];
  return (await serial.getPorts()).filter(isEspPort);
}

async function waitForEspPort(previous: SerialPort, waitMs: number): Promise<SerialPort> {
  const serial = navigator.serial;
  if (!serial) return previous;
  const pick = async (): Promise<SerialPort> => {
    const ports = await grantedEspPorts();
    return ports.find((p) => p !== previous) ?? ports[0] ?? previous;
  };
  const existing = await pick();
  if (existing !== previous) return existing;
  return new Promise((resolve) => {
    const finish = (port: SerialPort) => {
      window.clearTimeout(timer);
      serial.removeEventListener('connect', onConnect);
      resolve(port);
    };
    const onConnect = (ev: SerialConnectionEvent) => {
      const port = ev.port;
      if (port && isEspPort(port)) finish(port);
    };
    const timer = window.setTimeout(() => {
      void pick().then(finish);
    }, waitMs);
    serial.addEventListener('connect', onConnect);
  });
}

async function quietDtr(port: SerialPort): Promise<void> {
  try {
    await port.setSignals?.({ dataTerminalReady: false, requestToSend: false });
  } catch {
    /* USB Serial/JTAG often has no CDC control lines */
  }
}

function portLive(port: SerialPort): boolean {
  return Boolean(port.readable && port.writable);
}

async function openUsbPortOnce(port: SerialPort): Promise<SerialPort> {
  const options = { baudRate: USB_BAUD, bufferSize: USB_BUFFER, flowControl: 'none' as const };
  let current = port;
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (current.readable || current.writable) {
      await closeSerialPort(current);
      await delay(150);
    }
    try {
      await current.open(options);
      await quietDtr(current);
      return current;
    } catch (err) {
      last = err;
      await closeSerialPort(current);
      if (attempt < 4) {
        await delay(300 * (attempt + 1));
        current = await waitForEspPort(current, 2000 + attempt * 500);
      }
    }
  }
  throw last instanceof Error ? last : new Error(explainUsbOpenError(last));
}

async function waitForPortGone(port: SerialPort, ms: number): Promise<boolean> {
  const serial = navigator.serial;
  if (!serial) return !portLive(port);
  return new Promise((resolve) => {
    const finish = (gone: boolean) => {
      window.clearTimeout(timer);
      serial.removeEventListener('disconnect', onDisc);
      resolve(gone);
    };
    const onDisc = (ev: SerialConnectionEvent) => {
      if (ev.port === port || !portLive(port)) finish(true);
    };
    const timer = window.setTimeout(() => finish(!portLive(port)), ms);
    serial.addEventListener('disconnect', onDisc);
    if (!portLive(port)) finish(true);
  });
}

/** Opening native USB toggles DTR; this firmware also software-restarts once. Wait both out. */
async function settleUsbPort(port: SerialPort): Promise<SerialPort> {
  let current = port;
  for (let cycle = 0; cycle < 4; cycle++) {
    const gone = await waitForPortGone(current, 2000);
    if (!gone && portLive(current)) {
      await delay(500);
      if (portLive(current)) return current;
    }
    await closeSerialPort(current);
    await delay(2200);
    current = await openUsbPortOnce(await waitForEspPort(current, 5000));
  }
  if (portLive(current)) return current;
  throw new Error('Could not open the USB connection. Unplug the monitor, plug it back in, then try again.');
}

async function acquireUsbPort(preferred: SerialPort): Promise<SerialPort> {
  const tried = new Set<SerialPort>();
  const queue = [preferred, ...(await grantedEspPorts())];
  let last: unknown;
  for (const start of queue) {
    if (tried.has(start)) continue;
    tried.add(start);
    try {
      return await settleUsbPort(await openUsbPortOnce(start));
    } catch (err) {
      last = err;
    }
  }
  throw new Error(explainUsbOpenError(last));
}

async function chooseUsbPort(auto: boolean): Promise<SerialPort | null> {
  const granted = await grantedEspPorts();
  if (granted.length > 0) return granted[0];
  if (auto) return null;
  return navigator.serial!.requestPort({ filters: USB_FILTERS });
}

async function readUsbLines(
  port: SerialPort,
  signal: AbortSignal,
  onLine: (line: string) => void,
): Promise<void> {
  const readable = port.readable;
  if (!readable) return;
  const reader = readable.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) {
    onAbort();
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    return;
  }
  signal.addEventListener('abort', onAbort);
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      buf += decoder.decode(value, { stream: true });
      buf = buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.trim()) onLine(line);
        idx = buf.indexOf('\n');
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function chunkBytes(data: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    out.push(data.subarray(i, i + size));
  }
  return out;
}

export class LinkSession {
  private listeners = new Set<Listener>();
  private state: LinkState = { ...IDLE };
  private abort: AbortController | null = null;
  private write: ((line: string) => Promise<void>) | null = null;
  private closeTransport: (() => Promise<void>) | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private helloWaiters: Array<(msg: HelloMsg) => void> = [];
  private scanWaiters: Array<(msg: WifiScanMsg) => void> = [];
  private draining = false;
  private drainQueued = false;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private unloadBound = false;
  private identified = false;
  private onPageHide: (() => void) | null = null;
  private pump: Promise<void> | null = null;
  private connectChain: Promise<void> = Promise.resolve();
  private connectGen = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getState(): LinkState {
    return this.state;
  }

  isOpen(): boolean {
    return this.state.open && this.write !== null;
  }

  deviceId(): string | null {
    return this.state.deviceId;
  }

  matchesDevice(id: string): boolean {
    return this.isOpen() && this.state.deviceId === id.toUpperCase();
  }

  async connectUsb(opts?: { auto?: boolean }): Promise<void> {
    const auto = opts?.auto === true;
    const next = this.connectChain.then(() => this.connectUsbInner(auto));
    this.connectChain = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
  }

  /** Reopen a previously allowed USB monitor without showing the port picker. */
  async tryAutoConnectUsb(): Promise<void> {
    this.bindPageLifecycle();
    if (!autoUsbEnabled()) return;
    try {
      await this.connectUsb({ auto: true });
    } catch {
      /* stay disconnected; the user can click Connect USB */
    }
  }

  async disconnectByUser(): Promise<void> {
    this.connectGen += 1;
    setAutoUsb(false);
    await this.disconnect();
  }

  private async connectUsbInner(auto: boolean): Promise<void> {
    if (auto && this.isOpen()) return;
    if (typeof navigator === 'undefined' || !navigator.serial) {
      if (auto) return;
      this.failLink('USB is not available in this browser. Please use Chrome or Edge.');
    }
    const gen = this.connectGen;
    this.bindPageLifecycle();
    if (!auto) this.patch({ error: null, status: 'Connecting…' });
    let requested: SerialPort | null;
    try {
      requested = await chooseUsbPort(auto);
    } catch (err) {
      if ((err as { name?: string }).name === 'NotFoundError') throw err;
      if (auto) return;
      this.failLink(explainUsbOpenError(err));
    }
    if (!requested || gen !== this.connectGen) return;
    setAutoUsb(true);
    await this.disconnect();
    if (gen !== this.connectGen) return;
    this.patch({ error: null, status: 'Connecting…' });
    try {
      const port = await acquireUsbPort(requested);
      if (gen !== this.connectGen) {
        await closeSerialPort(port);
        return;
      }
      this.attachUsb(port);
      await this.startSession('usb', (signal, onLine) => this.runUsb(port, signal, onLine));
    } catch (err) {
      if (gen !== this.connectGen) return;
      if ((err as { name?: string }).name === 'NotFoundError') throw err;
      const status = explainUsbOpenError(err);
      await this.disconnect(auto ? undefined : status);
      if (auto) return;
      throw new Error(status);
    }
  }

  private attachUsb(port: SerialPort) {
    const encoder = new TextEncoder();
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    this.write = async (line: string) => {
      if (!port.writable) throw new Error('The USB connection was lost. Please connect again.');
      const w = port.writable.getWriter();
      writer = w;
      try {
        await w.write(encoder.encode(line.endsWith('\n') ? line : `${line}\n`));
      } finally {
        w.releaseLock();
        writer = null;
      }
    };
    this.closeTransport = async () => {
      try {
        writer?.releaseLock();
      } catch {
        /* ignore */
      }
      await closeSerialPort(port);
    };
  }

  private async runUsb(
    initial: SerialPort,
    signal: AbortSignal,
    onLine: (line: string) => void,
  ): Promise<void> {
    let port = initial;
    this.attachUsb(port);
    let drops = 0;
    while (!signal.aborted) {
      const started = Date.now();
      try {
        await readUsbLines(port, signal, onLine);
      } catch {
        if (signal.aborted) return;
      }
      if (signal.aborted) return;
      if (Date.now() - started < 1000) drops += 1;
      else drops = 0;
      if (drops > 8) {
        throw new Error('The USB connection was lost. Please connect again.');
      }
      this.patch({ status: 'Reconnecting…', error: null });
      await closeSerialPort(port);
      await delay(800);
      port = await settleUsbPort(await openUsbPortOnce(await waitForEspPort(port, 5000)));
      this.attachUsb(port);
      if (this.write) {
        try {
          await this.send({ type: 'hello' });
        } catch {
          /* next read cycle will retry */
        }
      }
    }
  }

  private failLink(status: string): never {
    this.patch({ ...IDLE, status: 'Not connected', error: status });
    throw new Error(status);
  }

  async connectBle(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      this.failLink('Bluetooth is not available in this browser. Please use Chrome or Edge.');
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: BLE_NAME_PREFIX }],
      optionalServices: [NUS_SERVICE],
    });
    await this.disconnect();
    const server = await device.gatt?.connect();
    if (!server) throw new Error('Could not connect over Bluetooth. Please try again.');
    const service = await server.getPrimaryService(NUS_SERVICE);
    const rx = await service.getCharacteristic(NUS_RX);
    const tx = await service.getCharacteristic(NUS_TX);
    const assembler = new LineAssembler();
    let onNotify: ((ev: Event) => void) | null = null;
    const encoder = new TextEncoder();

    this.write = async (line: string) => {
      const bytes = encoder.encode(line.endsWith('\n') ? line : `${line}\n`);
      for (const part of chunkBytes(bytes, 20)) {
        const chunk = toArrayBuffer(part);
        if (typeof rx.writeValueWithoutResponse === 'function') {
          await rx.writeValueWithoutResponse(chunk);
        } else {
          await rx.writeValue(chunk);
        }
      }
    };
    this.closeTransport = async () => {
      if (onNotify) tx.removeEventListener('characteristicvaluechanged', onNotify);
      try {
        await tx.stopNotifications();
      } catch {
        /* ignore */
      }
      try {
        server.disconnect();
      } catch {
        /* ignore */
      }
    };

    await this.startSession('ble', async (signal, onLine) => {
      onNotify = (ev: Event) => {
        const target = ev.target as unknown as BluetoothRemoteGATTCharacteristic;
        const value = target.value;
        if (!value) return;
        const copy = new Uint8Array(value.byteLength);
        for (let i = 0; i < value.byteLength; i++) copy[i] = value.getUint8(i);
        assembler.pushBytes(copy, onLine);
      };
      tx.addEventListener('characteristicvaluechanged', onNotify);
      await tx.startNotifications();
      await new Promise<void>((resolve) => {
        const onAbort = () => resolve();
        signal.addEventListener('abort', onAbort, { once: true });
        const onDisc = () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        device.addEventListener('gattserverdisconnected', onDisc);
      });
    });
  }

  async disconnect(reason?: string): Promise<void> {
    this.stopDrain();
    this.identified = false;
    this.helloWaiters = [];
    this.scanWaiters = [];
    const abort = this.abort;
    this.abort = null;
    abort?.abort();
    const pump = this.pump;
    this.pump = null;
    if (pump) {
      try {
        await pump;
      } catch {
        /* ignore */
      }
    }
    const close = this.closeTransport;
    this.write = null;
    this.closeTransport = null;
    if (close) {
      try {
        await close();
      } catch {
        /* ignore */
      }
    }
    this.patch({ ...IDLE, status: reason ? 'Not connected' : 'Disconnected', error: reason ?? null });
  }

  private loseLink(reason: string) {
    this.stopDrain();
    this.identified = false;
    this.helloWaiters = [];
    this.scanWaiters = [];
    const abort = this.abort;
    this.abort = null;
    abort?.abort();
    this.pump = null;
    const close = this.closeTransport;
    this.write = null;
    this.closeTransport = null;
    if (close) void close().catch(() => undefined);
    this.patch({ ...IDLE, status: 'Not connected', error: reason });
  }

  async send(msg: HostToDevice): Promise<void> {
    if (!this.write) throw new Error('The monitor is not connected.');
    const line = JSON.stringify(msg);
    this.writeChain = this.writeChain.then(() => this.write!(line)).catch(() => undefined);
    await this.writeChain;
  }

  async pushConfig(deviceId: string): Promise<void> {
    if (!this.matchesDevice(deviceId)) return;
    let cfg;
    try {
      cfg = normalizeConfig(await apiGet(`/v1/devices/${encodeURIComponent(deviceId)}/config`));
    } catch {
      cfg = normalizeConfig(await apiGet(`/v1/devices/${encodeURIComponent(deviceId)}`));
    }
    await this.send({
      type: 'set_config',
      configRev: cfg.configRev,
      channels: protocolChannels(cfg.channels),
    });
  }

  async pushTime(deviceId: string, unixTime: number): Promise<void> {
    if (!this.matchesDevice(deviceId)) return;
    await this.send({ type: 'set_time', unixTime });
  }

  async refreshStatus(): Promise<void> {
    if (!this.write) throw new Error('The monitor is not connected.');
    await this.send({ type: 'get_status' });
  }

  async setWifi(ssid: string, password: string): Promise<void> {
    if (!this.write) throw new Error('The monitor is not connected.');
    await this.send({ type: 'set_wifi', ssid, password });
  }

  async scanWifi(timeoutMs = 8000): Promise<WifiNetwork[]> {
    if (!this.write) throw new Error('The monitor is not connected.');
    const msg = await new Promise<WifiScanMsg | null>((resolve) => {
      const timer = window.setTimeout(() => {
        this.scanWaiters = this.scanWaiters.filter((w) => w !== waiter);
        resolve(null);
      }, timeoutMs);
      const waiter = (scan: WifiScanMsg) => {
        window.clearTimeout(timer);
        resolve(scan);
      };
      this.scanWaiters.push(waiter);
      void this.send({ type: 'scan_wifi' }).catch(() => {
        window.clearTimeout(timer);
        this.scanWaiters = this.scanWaiters.filter((w) => w !== waiter);
        resolve(null);
      });
    });
    return msg ? normalizeWifiScan(msg) : [];
  }

  private patch(partial: Partial<LinkState>) {
    this.state = { ...this.state, ...partial };
    for (const fn of this.listeners) fn(this.state);
  }

  private bindPageLifecycle() {
    if (this.unloadBound || typeof window === 'undefined') return;
    this.unloadBound = true;
    this.onPageHide = () => {
      void this.disconnect();
    };
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('beforeunload', this.onPageHide);
    window.addEventListener('pageshow', (ev: PageTransitionEvent) => {
      if (ev.persisted) void this.tryAutoConnectUsb();
    });
    const serial = navigator.serial;
    if (!serial) return;
    serial.addEventListener('connect', (ev: SerialConnectionEvent) => {
      if (!ev.port || !isEspPort(ev.port)) return;
      if (!autoUsbEnabled()) return;
      void this.tryAutoConnectUsb();
    });
  }

  private async startSession(
    transport: TransportKind,
    run: (signal: AbortSignal, onLine: (line: string) => void) => Promise<void>,
  ): Promise<void> {
    this.bindPageLifecycle();
    const abort = new AbortController();
    this.abort = abort;
    this.stopDrain();
    this.identified = false;
    this.patch({
      transport,
      open: true,
      deviceId: null,
      wifiState: null,
      claimed: null,
      forwarding: 0,
      status: 'Waiting for the monitor…',
    });

    const onLine = (line: string) => {
      void this.onLine(line);
    };

    const helloWait = transport === 'usb' ? 8000 : 2500;
    const firstHello = this.waitForHello(helloWait);
    this.pump = run(abort.signal, onLine)
      .then(() => {
        if (!abort.signal.aborted && transport === 'ble') {
          this.loseLink('The Bluetooth connection was lost. Please try again.');
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) this.loseLink(errorMessage(err));
      });

    if (this.write) {
      try {
        await this.send({ type: 'hello' });
      } catch {
        /* ignore */
      }
    }
    let hello = await firstHello;
    if (!hello && this.write && !this.identified) {
      try {
        await this.send({ type: 'hello' });
      } catch {
        /* ignore */
      }
      hello = await this.waitForHello(transport === 'usb' ? 8000 : 4000);
    }
    if (abort.signal.aborted) return;
    if (this.identified) return;
    if (!hello) {
      const status =
        transport === 'usb'
          ? 'The USB cable is connected, but the monitor did not answer. Unplug it, plug it back in, then try again.'
          : 'Connected over Bluetooth, but the monitor did not respond. Please try again.';
      this.patch({ status, error: status });
      throw new Error(status);
    }
    this.patch({ error: null });
    await this.onIdentified(hello);
  }

  private waitForHello(ms: number): Promise<HelloMsg | null> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.helloWaiters = this.helloWaiters.filter((w) => w !== waiter);
        resolve(null);
      }, ms);
      const waiter = (msg: HelloMsg) => {
        window.clearTimeout(timer);
        resolve(msg);
      };
      this.helloWaiters.push(waiter);
    });
  }

  private async onLine(line: string) {
    const msg = parseDeviceLine(line);
    if (!msg) return;
    if (isHello(msg)) {
      const waiters = this.helloWaiters;
      this.helloWaiters = [];
      for (const w of waiters) w(msg);
      this.patch({
        deviceId: msg.deviceId.toUpperCase(),
        claimed: msg.claimed,
        ...wifiNetFromMsg(msg),
      });
      if (!this.identified) {
        this.identified = true;
        void this.onIdentified(msg);
      } else {
        this.applyWifiState(msg.wifiState, msg.unackedCount);
      }
      return;
    }
    if (isWifiScan(msg)) {
      const waiters = this.scanWaiters;
      this.scanWaiters = [];
      for (const w of waiters) w(msg);
      return;
    }
    if (isStatus(msg)) {
      if (msg.deviceId) {
        this.patch({ deviceId: msg.deviceId.toUpperCase() });
      }
      if (typeof msg.claimed === 'boolean') {
        this.patch({ claimed: msg.claimed });
      }
      this.patch(wifiNetFromMsg(msg));
      if (this.identified) {
        this.applyWifiState(msg.wifiState, msg.unackedCount);
      }
      return;
    }
    if (msg.type === 'samples') {
      const snapshots = Array.isArray((msg as { snapshots?: IngestSnapshot[] }).snapshots)
        ? (msg as { snapshots: IngestSnapshot[] }).snapshots
        : [];
      await this.onSamples(snapshots);
    }
  }

  private applyWifiState(wifiState: WifiState, unackedCount?: number) {
    if (!shouldDrain(wifiState)) {
      this.stopDrain();
      this.patch({ status: 'Sending readings over Wi-Fi' });
      return;
    }
    if (this.identified && this.state.deviceId && !this.draining && (unackedCount ?? 0) > 0) {
      void this.startDrain();
    } else if (this.identified && this.state.deviceId && !this.draining) {
      this.scheduleDrain(drainRetryMs(false));
    }
  }

  private async onIdentified(hello: HelloMsg) {
    const deviceId = hello.deviceId.toUpperCase();
    this.patch({
      deviceId,
      claimed: hello.claimed,
      status: 'Connected',
      ...wifiNetFromMsg(hello),
    });

    if (!hello.claimed) {
      this.patch({ status: 'Adding this monitor…' });
      try {
        const claimed = normalizeClaim(
          await apiSend<unknown>('/v1/devices/claim', 'POST', { deviceId }),
        );
        await this.sendClaim(claimed, deviceId);
        this.patch({ claimed: true, status: 'Monitor added' });
      } catch (err) {
        this.patch({ status: `Could not add this monitor. ${errorMessage(err)}` });
        if (err instanceof ApiError && err.status === 409) {
          this.patch({ claimed: true, status: 'This monitor is already added.' });
        }
      }
    }

    try {
      await this.send({ type: 'set_time', unixTime: Math.floor(Date.now() / 1000) });
    } catch {
      /* Clock can still be set from Settings. */
    }

    if (!shouldDrain(hello.wifiState)) {
      this.patch({ status: 'Sending readings over Wi-Fi' });
      return;
    }
    await this.startDrain();
  }

  private async sendClaim(claimed: ClaimResponse, deviceId: string) {
    await this.send({
      type: 'claim',
      token: claimed.token,
      apiBaseUrl: API_BASE,
    });
    if (!claimed.token) {
      this.patch({ status: 'Monitor added, but setup is incomplete. Please connect again.' });
    }
  }

  private stopDrain() {
    this.draining = false;
    this.drainQueued = false;
    this.clearDrainTimer();
  }

  private clearDrainTimer() {
    if (this.drainTimer != null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  private scheduleDrain(delayMs: number) {
    if (!this.write || !this.identified || this.draining) return;
    if (!shouldDrain(this.state.wifiState)) return;
    this.clearDrainTimer();
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      void this.startDrain();
    }, delayMs);
  }

  private async startDrain() {
    if (this.draining) return;
    if (!shouldDrain(this.state.wifiState)) return;
    if (!this.write || !this.state.deviceId) return;
    this.clearDrainTimer();
    this.draining = true;
    if (this.state.forwarding > 0) {
      this.patch({ status: `Sending ${this.state.forwarding} stored readings…` });
    }
    await this.sendDrain();
  }

  private async sendDrain() {
    if (!this.draining || !shouldDrain(this.state.wifiState)) return;
    try {
      await this.send({ type: 'drain', limit: DRAIN_LIMIT });
    } catch (err) {
      this.patch({ status: `Could not send stored readings. ${errorMessage(err)}` });
      this.draining = false;
      this.scheduleDrain(drainRetryMs(true));
    }
  }

  private async onSamples(snapshots: IngestSnapshot[]) {
    if (!shouldDrain(this.state.wifiState)) return;
    const deviceId = this.state.deviceId;
    if (!deviceId) return;
    if (!snapshots.length) {
      this.draining = false;
      this.patch({
        forwarding: 0,
        status: this.state.open ? 'Connected' : this.state.status,
      });
      this.scheduleDrain(drainRetryMs(false));
      return;
    }
    try {
      const res = normalizeIngest(
        await apiSend('/v1/ingest', 'POST', { deviceId, snapshots }),
      );
      const n = res.inserted ?? snapshots.length;
      const forwarding = this.state.forwarding + n;
      this.patch({ forwarding, status: `Sending ${forwarding} stored readings…` });
      const ack = flushAckFromIngest(res);
      if (!ack) {
        this.patch({ status: 'Could not confirm stored readings were saved.' });
        this.draining = false;
        this.scheduleDrain(drainRetryMs(true));
        return;
      }
      await this.send(ack);
    } catch (err) {
      this.patch({ status: `Could not send stored readings. ${errorMessage(err)}` });
      this.draining = false;
      this.scheduleDrain(drainRetryMs(true));
      return;
    }
    if (this.draining && shouldDrain(this.state.wifiState)) {
      await this.sendDrain();
    }
  }
}

export const linkSession = new LinkSession();

export function useLinkSession(): LinkState {
  const [state, setState] = useState<LinkState>(() => linkSession.getState());
  useEffect(() => linkSession.subscribe(setState), []);
  return state;
}
