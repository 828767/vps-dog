import type { ReactNode } from 'react';

export type NoticeTone = 'danger' | 'warn';

/** Tone fragments, shared with `ErrorBanner` so every strip matches. */
export const NOTICE_TONE: Record<NoticeTone, string> = {
  danger: 'border-danger/30 bg-danger/8 text-danger',
  warn: 'border-warn/30 bg-warn/8 text-warn',
};

export interface NoticeProps {
  tone?: NoticeTone;
  role?: 'alert' | 'status';
  children: ReactNode;
  className?: string;
}

/**
 * Inline notice strip. Before this existed the same `rounded-xl border-…/30
 * bg-…/8 px-3.5 py-2.5 text-xs` string was copy-pasted into six places across
 * the admin forms and the node detail page.
 */
export function Notice({ tone = 'danger', role, children, className = '' }: NoticeProps): ReactNode {
  return (
    <p role={role} className={`rounded-xl border px-3.5 py-2.5 text-xs ${NOTICE_TONE[tone]} ${className}`}>
      {children}
    </p>
  );
}

/** Form-level error; announced to assistive tech. */
export function FormError({ message }: { message: string }): ReactNode {
  return (
    <Notice tone="danger" role="alert">
      {message}
    </Notice>
  );
}
