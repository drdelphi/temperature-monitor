import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiSend } from './api';
import { LinkSession } from './link-session';
import { selectMonitorUsbPort } from './usb-ports';

vi.mock('./api', async importOriginal => {
  const original = await importOriginal<typeof import('./api')>();
  return { ...original, apiGet: vi.fn(), apiSend: vi.fn() };
});

type SessionHarness = {
  write: (line: string) => Promise<void>;
  startSession: (transport: 'usb', run: (signal: AbortSignal, onLine: (line: string) => void) => Promise<void>) => Promise<void>;
};

const hello = (claimed = false) => JSON.stringify({
  type: 'hello', deviceId: '78E36DDEA174', claimed,
  wifiState: 'ingesting', unackedCount: 0, name: 'Probe box', configRev: 0,
});

describe('monitor registration before navigation', () => {
  let session: LinkSession;
  let wire: ReturnType<typeof vi.fn<(line: string) => Promise<void>>>;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', { setTimeout, clearTimeout, addEventListener: vi.fn() });
    vi.stubGlobal('navigator', {});
    session = new LinkSession();
    wire = vi.fn<(line: string) => Promise<void>>().mockResolvedValue(undefined);
    (session as unknown as SessionHarness).write = wire;
  });
  afterEach(async () => {
    await session.disconnect();
    vi.unstubAllGlobals();
  });

  function connect(claimed = false) {
    return (session as unknown as SessionHarness).startSession('usb', (signal, onLine) => {
      onLine(hello(claimed));
      return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    });
  }

  it('keeps the connect promise pending until the server creates the monitor', async () => {
    let finishClaim!: (value: unknown) => void;
    vi.mocked(apiSend).mockReturnValue(new Promise(resolve => { finishClaim = resolve; }));
    let finished = false;
    const connection = connect().then(() => { finished = true; });
    await vi.waitFor(() => expect(apiSend).toHaveBeenCalled());
    expect(finished).toBe(false);
    expect(wire.mock.calls.some(([line]) => JSON.parse(line).type === 'drain')).toBe(false);
    finishClaim({ token: 'test-token', deviceId: '78E36DDEA174' });
    await connection;
    expect(session.getState().claimed).toBe(true);
    expect(wire.mock.calls.some(([line]) => JSON.parse(line).type === 'claim')).toBe(true);
  });

  it('rejects the connection when registration fails, preventing navigation', async () => {
    vi.mocked(apiSend).mockRejectedValue(new ApiError(500, 'Registration failed'));
    await expect(connect()).rejects.toThrow();
    expect(session.getState().error).toContain('Could not add this monitor');
    expect(wire.mock.calls.some(([line]) => JSON.parse(line).type === 'claim')).toBe(false);
  });

  it('registers a locally claimed monitor when it is missing from this server', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(404, 'This monitor was not found.'));
    vi.mocked(apiSend).mockResolvedValue({ token: 'test-token' });
    await connect(true);
    expect(apiSend).toHaveBeenCalledWith('/v1/devices/claim', 'POST', { deviceId: '78E36DDEA174' });
  });

  it('does not rotate the token of an already registered monitor', async () => {
    vi.mocked(apiGet).mockResolvedValue({ id: '78E36DDEA174' });
    await connect(true);
    expect(apiSend).not.toHaveBeenCalled();
  });

  it('does not attempt registration after an authentication or network error', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError(401, 'Please sign in again.'));
    await expect(connect(true)).rejects.toThrow();
    expect(apiSend).not.toHaveBeenCalled();
  });
});

describe('manual USB selection', () => {
  it('always shows the picker even when a port was already granted', async () => {
    const saved = { getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }) } as SerialPort;
    const serial = { getPorts: vi.fn().mockResolvedValue([saved]), requestPort: vi.fn().mockResolvedValue(saved) };
    expect(await selectMonitorUsbPort(serial, false)).toBe(saved);
    expect(serial.requestPort).toHaveBeenCalledWith();
    expect(serial.getPorts).not.toHaveBeenCalled();
  });

  it('uses granted supported ports without prompting during automatic reconnect', async () => {
    const saved = { getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }) } as SerialPort;
    const serial = { getPorts: vi.fn().mockResolvedValue([saved]), requestPort: vi.fn() };
    expect(await selectMonitorUsbPort(serial, true)).toBe(saved);
    expect(serial.requestPort).not.toHaveBeenCalled();
  });
});
