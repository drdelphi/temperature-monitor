import { isValidBValue } from './curves';
import type { Channel } from './types';

export type ChannelDraft = {
  name: string;
  enabled: boolean;
  intervalSec: string;
  offset: number;
  gain: number;
  bValue: number;
};

export function channelToDraft(ch: Pick<Channel, 'name' | 'enabled' | 'intervalSec' | 'offset' | 'gain' | 'bValue'>): ChannelDraft {
  return {
    name: ch.name,
    enabled: ch.enabled,
    intervalSec: String(ch.intervalSec),
    offset: ch.offset,
    gain: ch.gain,
    bValue: ch.bValue,
  };
}

export function draftsFromChannels(
  channels: Array<Pick<Channel, 'index' | 'name' | 'enabled' | 'intervalSec' | 'offset' | 'gain' | 'bValue'>>,
): Record<number, ChannelDraft> {
  const next: Record<number, ChannelDraft> = {};
  for (const ch of channels) next[ch.index] = channelToDraft(ch);
  return next;
}

export function isChannelDirty(draft: ChannelDraft, saved: ChannelDraft): boolean {
  return (
    draft.name !== saved.name ||
    draft.enabled !== saved.enabled ||
    draft.intervalSec !== saved.intervalSec ||
    draft.offset !== saved.offset ||
    draft.gain !== saved.gain ||
    draft.bValue !== saved.bValue
  );
}

export function isSensorsDirty(
  drafts: Record<number, ChannelDraft>,
  saved: Record<number, ChannelDraft>,
): boolean {
  const keys = new Set([...Object.keys(drafts), ...Object.keys(saved)]);
  for (const key of keys) {
    const i = Number(key);
    const draft = drafts[i];
    const keep = saved[i];
    if (!draft || !keep || isChannelDirty(draft, keep)) return true;
  }
  return false;
}

export function normalizeDraft(draft: ChannelDraft): ChannelDraft {
  const interval = Math.floor(Number(draft.intervalSec));
  return {
    ...draft,
    name: draft.name.trim(),
    intervalSec: Number.isFinite(interval) && interval >= 1 ? String(interval) : draft.intervalSec,
  };
}

export function validateDraft(draft: ChannelDraft): string | null {
  if (!draft.name.trim()) return 'Each sensor needs a name.';
  const interval = Math.floor(Number(draft.intervalSec));
  if (!Number.isFinite(interval) || interval < 1) return 'Interval must be at least 1 second.';
  if (!isValidBValue(draft.bValue)) return 'Enter a B value between 1000 and 8000.';
  return null;
}

export function validateDrafts(drafts: Record<number, ChannelDraft>): string | null {
  for (const draft of Object.values(drafts)) {
    const err = validateDraft(draft);
    if (err) return err;
  }
  return null;
}

export function channelPatchBody(draft: ChannelDraft, saved: ChannelDraft): Record<string, unknown> | null {
  const next = normalizeDraft(draft);
  const prev = normalizeDraft(saved);
  const body: Record<string, unknown> = {};
  if (next.name !== prev.name) body.name = next.name;
  if (next.enabled !== prev.enabled) body.enabled = next.enabled;
  if (next.intervalSec !== prev.intervalSec) body.intervalSec = Number(next.intervalSec);
  if (next.offset !== prev.offset) body.offset = next.offset;
  if (next.gain !== prev.gain) body.gain = next.gain;
  if (next.bValue !== prev.bValue) body.bValue = next.bValue;
  return Object.keys(body).length ? body : null;
}
