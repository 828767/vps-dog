import type { ReactNode } from 'react';

export interface SparklineProps {
  /** Latency samples in ms; `-1`/`null` marks a failed probe. */
  values: ReadonlyArray<number>;
  /** Width in px. */
  width?: number;
  height?: number;
  stroke?: string;
  /** Draw a soft area fill under the line. */
  fill?: boolean;
  className?: string;
  ariaLabel?: string;
}

/** Tiny inline SVG sparkline — used in the ping table. */
export function Sparkline({
  values,
  width = 96,
  height = 26,
  stroke = 'var(--accent)',
  fill = true,
  className = '',
  ariaLabel,
}: SparklineProps): ReactNode {
  const usable = values.filter((value) => Number.isFinite(value) && value >= 0);

  if (usable.length === 0) {
    return (
      <span
        className={`inline-block align-middle text-xs text-muted ${className}`}
        style={{ width, height, lineHeight: `${height}px` }}
        aria-label={ariaLabel}
      >
        –
      </span>
    );
  }

  const max = Math.max(...usable);
  const min = Math.min(...usable);
  const span = max - min;
  const pad = 2;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);

  const pointAt = (index: number, value: number): [number, number] => {
    const x = pad + (values.length <= 1 ? innerW / 2 : (index / (values.length - 1)) * innerW);
    // Flat series render on the middle line rather than collapsing to the floor.
    const ratio = span === 0 ? 0.5 : (value - min) / span;
    const y = pad + innerH - ratio * innerH;
    return [x, y];
  };

  const segments: string[] = [];
  let open = false;
  values.forEach((value, index) => {
    const valid = Number.isFinite(value) && value >= 0;
    if (!valid) {
      open = false;
      return;
    }
    const [x, y] = pointAt(index, value);
    segments.push(`${open ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    open = true;
  });

  const linePath = segments.join(' ');
  const [firstX] = pointAt(0, min);
  const [lastX] = pointAt(values.length - 1, min);
  const areaPath = `${linePath} L${lastX.toFixed(1)} ${(height - pad).toFixed(1)} L${firstX.toFixed(1)} ${(height - pad).toFixed(1)} Z`;

  const gradientId = `spark-${Math.abs(
    values.length * 31 + Math.round(min * 10) + Math.round(max * 10),
  )}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`inline-block align-middle overflow-visible ${className}`}
      role={ariaLabel === undefined ? undefined : 'img'}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel === undefined ? true : undefined}
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
