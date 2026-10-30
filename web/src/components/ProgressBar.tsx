import type { ReactNode } from 'react';
import { percent, thresholdTone } from '../lib/format';

export interface ProgressBarProps {
  /** 0–100. Values outside the range are clamped. */
  value: number | null | undefined;
  /** Optional caption rendered above the bar. */
  label?: string;
  /** Optional trailing text; defaults to the formatted percentage. */
  valueText?: string;
  /** Show the percentage next to the label. */
  showValue?: boolean;
  size?: 'sm' | 'md';
  /** Force a tone instead of deriving it from the value. */
  tone?: 'success' | 'warn' | 'danger' | 'accent' | 'muted';
  className?: string;
}

const TONE_BG: Record<'success' | 'warn' | 'danger' | 'accent' | 'muted', string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
  accent: 'bg-accent',
  muted: 'bg-muted/50',
};

/** Thin meter whose colour shifts green → amber → red with the value. */
export function ProgressBar({
  value,
  label,
  valueText,
  showValue = true,
  size = 'sm',
  tone,
  className = '',
}: ProgressBarProps): ReactNode {
  const safe = typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const resolvedTone = tone ?? thresholdTone(safe);
  const height = size === 'sm' ? 'h-1.5' : 'h-2';

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label !== undefined || showValue ? (
        <div className="flex items-baseline justify-between gap-3">
          {label !== undefined ? (
            <span className="text-xs font-medium text-muted">{label}</span>
          ) : (
            <span />
          )}
          {showValue ? (
            <span className="num text-xs font-medium text-text">
              {valueText ?? percent(safe, 1, value === null || value === undefined)}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className={`w-full overflow-hidden rounded-full bg-surface-2 ${height}`}
        role="progressbar"
        aria-valuenow={Math.round(safe)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full ${TONE_BG[resolvedTone]} transition-[width] duration-500 ease-out`}
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}
