'use client';

import { useLinkSession } from '@/lib/link-session';
import { ErrorText } from './ui';

export function HomeEmpty() {
  const link = useLinkSession();
  return (
    <div className="empty">
      <p>Select a monitor in the left panel, or add one over USB or Bluetooth.</p>
      <ErrorText>{link.error}</ErrorText>
    </div>
  );
}
