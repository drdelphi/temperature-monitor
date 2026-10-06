import { USB_ESP_PID, USB_ESP_VID } from './config';

// Restrict automatic reconnection to known adapters. Manual selection remains
// unfiltered so other USB-UART bridges can also be explicitly selected.
const AUTO_USB_FILTERS: SerialPortFilter[] = [
  { usbVendorId: USB_ESP_VID, usbProductId: USB_ESP_PID },
  { usbVendorId: 0x10c4, usbProductId: 0xea60 }, // CP210x
  { usbVendorId: 0x1a86, usbProductId: 0x7523 }, // CH340
  { usbVendorId: 0x1a86, usbProductId: 0x55d4 }, // CH9102
  { usbVendorId: 0x0403, usbProductId: 0x6001 }, // FT232
];

export function isMonitorUsbPort(port: Pick<SerialPort, 'getInfo'>): boolean {
  try {
    const info = port.getInfo();
    return AUTO_USB_FILTERS.some(filter =>
      info.usbVendorId === filter.usbVendorId &&
      (info.usbProductId == null || info.usbProductId === filter.usbProductId));
  } catch {
    return false;
  }
}

export async function selectMonitorUsbPort(
  serial: Pick<Serial, 'getPorts' | 'requestPort'>,
  auto: boolean,
): Promise<SerialPort | null> {
  // A manual Add USB click must always let the user choose, even after a failure.
  if (!auto) return serial.requestPort();
  return (await serial.getPorts()).find(isMonitorUsbPort) ?? null;
}
