export type DevicePatchInput = {
  name?: string;
  pendingUnixTime?: number | null;
};

export type DevicePatchData = {
  name?: string;
  pendingUnixTime?: bigint | null;
  configRev?: { increment: number };
};

export function devicePatchData(dto: DevicePatchInput): DevicePatchData {
  const data: DevicePatchData = {};
  if (dto.name !== undefined) {
    data.name = dto.name;
  }
  if (dto.pendingUnixTime !== undefined) {
    if (dto.pendingUnixTime == null) {
      data.pendingUnixTime = null;
    } else {
      data.pendingUnixTime = BigInt(dto.pendingUnixTime);
      data.configRev = { increment: 1 };
    }
  }
  return data;
}

/** Device-token config GET is the Wi-Fi delivery of a queued clock. Consume it once. */
export function shouldConsumePendingTime(authKind: string | undefined): boolean {
  return authKind === 'device';
}
