'use client';

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger' }) {
  const v = variant === 'default' ? '' : ` btn-${variant}`;
  return <button type="button" className={`btn${v} ${className}`.trim()} {...props} />;
}

export function Toggle({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" className={`toggle${on ? ' on' : ''}`} onClick={onClick} title={title} aria-pressed={on}>
      <i />
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="err">{children}</div>;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  confirmVariant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'default' | 'primary' | 'ghost' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="modal-back" onClick={busy ? undefined : onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title">{title}</h3>
        <div className="modal-body">{children}</div>
        <div className="row">
          <Button variant={confirmVariant} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
