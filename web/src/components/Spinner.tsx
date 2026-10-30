import type { ReactNode } from 'react';

export interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

/** Minimal CSS spinner; inherits `currentColor`. */
export function Spinner({ size = 16, className = '', label }: SpinnerProps): ReactNode {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin"
        focusable="false"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/** Centered block spinner for page-level loading. */
export function LoadingBlock({ label }: { label: string }): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
      <Spinner size={26} />
      <p className="text-sm">{label}</p>
    </div>
  );
}
