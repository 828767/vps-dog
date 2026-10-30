import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'muted';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
  /** Renders a small leading dot in the tone colour. */
  dot?: boolean;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface-2 text-text',
  accent: 'border-accent/35 bg-accent/12 text-accent',
  success: 'border-success/35 bg-success/12 text-success',
  warn: 'border-warn/35 bg-warn/12 text-warn',
  danger: 'border-danger/35 bg-danger/12 text-danger',
  muted: 'border-border bg-surface-2 text-muted',
};

/** Small pill used for groups, regions, tags and statuses. */
export function Badge({ children, tone = 'neutral', className = '', title, dot }: BadgeProps): ReactNode {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium transition-colors duration-150 ${TONE_CLASS[tone]} ${className}`}
    >
      {dot ? <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export interface StatusDotProps {
  online: boolean;
  label: string;
  size?: 'sm' | 'md';
}

/** Online = green dot with a soft ping halo; offline = muted grey. */
export function StatusDot({ online, label, size = 'md' }: StatusDotProps): ReactNode {
  const box = size === 'sm' ? 'size-2' : 'size-2.5';
  const halo = size === 'sm' ? 'size-2' : 'size-2.5';
  return (
    <span className="relative inline-flex shrink-0" role="img" aria-label={label} title={label}>
      {online ? (
        <span
          className={`absolute inline-flex ${halo} animate-ping rounded-full bg-success opacity-60`}
          aria-hidden="true"
        />
      ) : null}
      <span
        className={`relative inline-flex ${box} rounded-full ${
          online ? 'bg-success' : 'bg-muted/50'
        } transition-colors duration-150`}
        aria-hidden="true"
      />
    </span>
  );
}
