import type { ReactNode } from 'react';

/** Colour of the big number and the icon tile. */
export type StatCardTone = 'default' | 'success' | 'warn' | 'danger' | 'accent' | 'muted';

export interface StatCardProps {
  label: string;
  /** Pre-formatted value; the card never formats numbers itself. */
  value: string;
  unit?: string;
  /** Secondary line under the value. */
  hint?: string;
  /** Rendered in a tinted tile on the left. */
  icon?: ReactNode;
  tone?: StatCardTone;
  /** Tile colour when it should differ from the value's (e.g. blue tile, white number). */
  iconTone?: StatCardTone;
  /** Right-aligned slot: a badge or a short caption. */
  trailing?: ReactNode;
  className?: string;
}

const TONE_TEXT: Record<StatCardTone, string> = {
  default: 'text-text',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
  accent: 'text-accent',
  muted: 'text-muted',
};

const TONE_TILE: Record<StatCardTone, string> = {
  default: 'bg-surface-2 text-muted',
  success: 'bg-success/12 text-success',
  warn: 'bg-warn/12 text-warn',
  danger: 'bg-danger/12 text-danger',
  accent: 'bg-accent/12 text-accent',
  muted: 'bg-surface-2 text-muted',
};

/**
 * Compact KPI tile: tinted icon, label, big tabular number and an optional
 * trailing badge.
 *
 * This is the only KPI tile in the app — the dashboard's fleet strip, the admin
 * overview and the node detail page all render through it, so the three cannot
 * drift apart.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'default',
  iconTone,
  trailing,
  className = '',
}: StatCardProps): ReactNode {
  const tileTone = iconTone ?? tone;
  return (
    <div
      className={`card flex items-center gap-3.5 p-4 transition-colors duration-150 hover:border-accent/40 ${className}`}
    >
      {icon !== undefined ? (
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${TONE_TILE[tileTone]}`}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-xs font-medium text-muted">{label}</span>
        <div className="flex items-baseline gap-1.5">
          <span className={`num text-2xl leading-none font-semibold ${TONE_TEXT[tone]}`}>
            {value}
          </span>
          {unit !== undefined ? (
            <span className="text-xs font-medium text-muted">{unit}</span>
          ) : null}
        </div>
        {hint !== undefined ? (
          <span className="truncate text-[11px] text-muted/85" title={hint}>
            {hint}
          </span>
        ) : null}
      </div>

      {trailing !== undefined ? <div className="shrink-0 self-start pt-0.5">{trailing}</div> : null}
    </div>
  );
}

/** Loading placeholder matching the tile's rhythm. */
export function StatCardSkeleton(): ReactNode {
  return (
    <div className="card flex items-center gap-3.5 p-4">
      <div className="skeleton size-10 shrink-0 rounded-xl" />
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="skeleton h-3 w-16" />
        <div className="skeleton h-6 w-12" />
      </div>
    </div>
  );
}
