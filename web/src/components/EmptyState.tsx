import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: 'default' | 'danger';
  compact?: boolean;
}

function DefaultIcon({ tone }: { tone: 'default' | 'danger' }): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-6 ${tone === 'danger' ? 'text-danger' : 'text-muted'}`}
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="4"
        width="18"
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="3"
        y="13"
        width="18"
        height="7"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <circle cx="7" cy="7.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Friendly placeholder for empty lists, failed loads and “no results”. */
export function EmptyState({
  title,
  hint,
  icon,
  action,
  tone = 'default',
  compact = false,
}: EmptyStateProps): ReactNode {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-center ${
        compact ? 'px-4 py-8' : 'px-6 py-14'
      }`}
    >
      <div
        className={`flex size-11 items-center justify-center rounded-full ${
          tone === 'danger' ? 'bg-danger/10' : 'bg-surface-2'
        }`}
      >
        {icon ?? <DefaultIcon tone={tone} />}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {hint !== undefined ? (
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted">{hint}</p>
        ) : null}
      </div>
      {action !== undefined ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
