import type { ReactNode } from 'react';

export interface DonutSlice {
  label: string;
  value: number;
  /** Any CSS colour. */
  color: string;
}

export interface DonutProps {
  slices: ReadonlyArray<DonutSlice>;
  size?: number;
  thickness?: number;
  /** Rendered inside the ring, stacked. */
  centerTop?: ReactNode;
  centerBottom?: ReactNode;
  ariaLabel: string;
}

/**
 * Multi-arc SVG donut. Plain SVG rather than a chart library — it is a handful
 * of `stroke-dasharray` circles, and this way it themes through CSS vars for
 * free and costs nothing on the dashboard's hot path.
 */
export function Donut({
  slices,
  size = 150,
  thickness = 15,
  centerTop,
  centerBottom,
  ariaLabel,
}: DonutProps): ReactNode {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let offset = 0;
  const arcs = slices.map((slice) => {
    const fraction = total > 0 ? Math.max(0, slice.value) / total : 0;
    const length = circumference * fraction;
    const arc = (
      <circle
        key={slice.label}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={slice.color}
        strokeWidth={thickness}
        strokeDasharray={`${length} ${circumference - length}`}
        strokeDashoffset={-offset}
        // CSS transitions turn attribute updates into smooth ring sweeps.
        style={{ transition: 'stroke-dasharray 600ms ease-out, stroke-dashoffset 600ms ease-out' }}
      />
    );
    offset += length;
    return arc;
  });

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        {/* Rotate so the first slice starts at 12 o'clock. */}
        <g transform={`rotate(-90 ${center} ${center})`}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth={thickness}
          />
          {total > 0 ? arcs : null}
        </g>
      </svg>
      {centerTop !== undefined || centerBottom !== undefined ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-1 text-center">
          {centerTop}
          {centerBottom}
        </div>
      ) : null}
    </div>
  );
}
