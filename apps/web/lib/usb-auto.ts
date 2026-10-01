export const AUTO_USB_KEY = 'tempmon.autoUsb';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(override?: Store | null): Store | null {
  if (override !== undefined) return override;
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Missing key means “try if the browser already granted a port” so older sessions reconnect. */
export function autoUsbEnabled(store?: Store | null): boolean {
  try {
    const s = storage(store);
    if (!s) return true;
    return s.getItem(AUTO_USB_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAutoUsb(on: boolean, store?: Store | null): void {
  try {
    const s = storage(store);
    if (!s) return;
    s.setItem(AUTO_USB_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}
