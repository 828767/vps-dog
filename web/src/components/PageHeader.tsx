import type { ReactNode } from 'react';
import { NOTICE_TONE } from './Notice';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Shared page title block for the admin pages. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps): ReactNode {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight text-text">{title}</h1>
        {subtitle !== undefined ? <p className="text-xs text-muted">{subtitle}</p> : null}
      </div>
      {actions !== undefined ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  retryLabel: string;
}

/** Inline error strip with an optional retry affordance. */
export function ErrorBanner({ message, onRetry, retryLabel }: ErrorBannerProps): ReactNode {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs ${NOTICE_TONE.danger}`}
    >
      <span className="min-w-0 break-words">{message}</span>
      {onRetry !== undefined ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-lg border border-danger/35 px-2 py-1 font-medium transition-colors duration-150 hover:bg-danger/12"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
