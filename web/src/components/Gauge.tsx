import type { ReactNode } from 'react';
import { percent, thresholdTone } from '../lib/format';

export interface GaugeProps {
  /** 0–100. */
  value: number | null | undefined;
  label: string;
  /** Secondary line under the value (e.g. "3.2 / 8.0 GB"). */
  sublabel?: string;
  size?: number;
  thickness?: number;
  /** Overrides the automatic green/amber/red threshold colour. */
  tone?: 'success' | 'warn' | 'danger' | 'accent';
}

const TONE_VAR: Record<'success' | 'warn' | 'danger' | 'accent', string> = {
  success: 'var(--success)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  accent: 'var(--accent)',
};

/** SVG ring gauge — no chart library needed for a single number. */
export function Gauge({
  value,
  label,
  sublabel,
  size = 132,
  thickness = 9,
  tone,
}: GaugeProps): ReactNode {
  const safe =
    typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const resolvedTone = tone ?? thresholdTone(safe);
  const color = TONE_VAR[resolvedTone];

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // 270° arc, rotated so the gap sits at the bottom.
  const sweep = 0.75;
  const arc = circumference * sweep;
  const filled = arc * (safe / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label}: ${percent(safe)}`}
        >
          <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--border)"
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${arc} ${circumference}`}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${circumference}`}
              style={{ transition: 'stroke-dasharray 600ms ease-out, stroke 200ms ease' }}
            />
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="num text-xl font-semibold text-text">{percent(safe, 0)}</span>
          <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
            {label}
          </span>
        </div>
      </div>
      {sublabel !== undefined ? (
        <span className="num text-xs text-muted">{sublabel}</span>
      ) : null}
    </div>
  );
}
