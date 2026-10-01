import { describe, expect, it } from 'vitest';
import { AUTO_USB_KEY, autoUsbEnabled, setAutoUsb } from './usb-auto';

function mem(initial?: Record<string, string>): Storage {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe('autoUsbEnabled', () => {
  it('reconnects when the user has not opted out', () => {
    expect(autoUsbEnabled(mem())).toBe(true);
    expect(autoUsbEnabled(mem({ [AUTO_USB_KEY]: '1' }))).toBe(true);
  });

  it('stays off after an explicit disconnect', () => {
    const store = mem();
    setAutoUsb(false, store);
    expect(store.getItem(AUTO_USB_KEY)).toBe('0');
    expect(autoUsbEnabled(store)).toBe(false);
  });

  it('turns back on after a later USB connect', () => {
    const store = mem({ [AUTO_USB_KEY]: '0' });
    setAutoUsb(true, store);
    expect(autoUsbEnabled(store)).toBe(true);
  });
});
