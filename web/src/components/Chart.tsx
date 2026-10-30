import * as echarts from 'echarts';
import type { ECharts, EChartsOption, LineSeriesOption } from 'echarts';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { cssVar } from '../lib/format';
import { useTheme } from '../lib/theme';

export interface ChartProps {
  option: EChartsOption;
  /** CSS height; numbers are treated as pixels. */
  height?: number | string;
  className?: string;
  ariaLabel?: string;
}

/** Vertical gradient used for the area fill under every line. */
export function gradientFill(
  color: string,
  topOpacity = 0.28,
): NonNullable<LineSeriesOption['areaStyle']>['color'] {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: withAlpha(color, topOpacity) },
      { offset: 1, color: withAlpha(color, 0) },
    ],
  };
}

/** `#3b82f6` + 0.28 → `rgba(59,130,246,0.28)`; passes other formats through. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const r = Number.parseInt(hex[1] + hex[1], 16);
    const g = Number.parseInt(hex[2] + hex[2], 16);
    const b = Number.parseInt(hex[3] + hex[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
}

/** Theme-aware line series with smooth curve + gradient area, no symbols. */
export function lineSeries(
  name: string,
  data: ReadonlyArray<[number, number]>,
  color: string,
  options: { area?: boolean; dashed?: boolean; width?: number } = {},
): LineSeriesOption {
  const { area = true, dashed = false, width = 2 } = options;
  return {
    name,
    type: 'line',
    data: data as Array<[number, number]>,
    showSymbol: false,
    smooth: 0.28,
    smoothMonotone: 'x',
    sampling: 'lttb',
    lineStyle: {
      width,
      color,
      type: dashed ? 'dashed' : 'solid',
    },
    itemStyle: { color },
    emphasis: { focus: 'series', scale: false },
    areaStyle: area ? { color: gradientFill(color), opacity: 1 } : undefined,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep merge for option fragments; arrays are replaced, not concatenated. */
function mergeOption<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const existing = out[key];
    out[key] = isPlainObject(existing) && isPlainObject(value) ? mergeOption(existing, value) : value;
  }
  return out as T;
}

/** Chrome shared by every chart: faint horizontal grid only, crosshair tooltip,
 *  no axis lines, no ticks, muted labels, transparent background. */
function chartChrome(dark: boolean): EChartsOption {
  const text = cssVar('--text', dark ? '#e6edf3' : '#0f172a');
  const muted = cssVar('--muted', '#8b98a5');
  const border = cssVar('--border', '#1f2a36');
  const surface = cssVar('--surface', dark ? '#131a22' : '#ffffff');

  return {
    backgroundColor: 'transparent',
    animationDuration: 320,
    animationEasing: 'cubicOut',
    textStyle: {
      color: text,
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      fontSize: 11,
    },
    grid: { left: 6, right: 10, top: 22, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: surface,
      borderColor: border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: text, fontSize: 12 },
      extraCssText: 'border-radius: 10px; box-shadow: none;',
      axisPointer: {
        type: 'line',
        lineStyle: { color: muted, width: 1, type: 'dashed', opacity: 0.7 },
        label: { show: false },
      },
    },
    legend: {
      show: false,
      top: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 14,
      textStyle: { color: muted, fontSize: 11 },
    },
    xAxis: {
      type: 'time',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: muted, hideOverlap: true, margin: 10 },
    },
    yAxis: {
      type: 'value',
      scale: false,
      axisLine: { show: false },
      axisTick: { show: false },
      splitNumber: 4,
      // The only grid lines in the whole chart.
      splitLine: { show: true, lineStyle: { color: border, width: 1, opacity: 0.75 } },
      axisLabel: { color: muted, margin: 10 },
    },
  };
}

/**
 * Imperative ECharts wrapper.
 *
 * Owns init / setOption / resize / dispose, and re-creates the instance when the
 * resolved theme flips so axis, tooltip and grid colours follow the CSS vars.
 */
export function Chart({ option, height = 220, className = '', ariaLabel }: ChartProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const { resolved } = useTheme();
  const dark = resolved === 'dark';

  // (Re)create the instance whenever the theme changes.
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;

    const instance = echarts.init(element, dark ? 'dark' : undefined, {
      renderer: 'canvas',
    });
    instanceRef.current = instance;

    const observer = new ResizeObserver(() => {
      // `resize` on a disposed instance throws; guard defensively.
      if (!instance.isDisposed()) instance.resize();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, [dark]);

  const merged = useMemo<EChartsOption>(
    () => mergeOption(chartChrome(dark) as Record<string, unknown>, option as Record<string, unknown>) as EChartsOption,
    [dark, option],
  );

  useEffect(() => {
    const instance = instanceRef.current;
    if (instance === null || instance.isDisposed()) return;
    // Merge mode (the default): a data update morphs the existing series into
    // place. `notMerge: true` here would rebuild every series and replay the
    // entry animation on each poll cycle, which read as the page flashing.
    // The instance is recreated on theme change, so stale styling cannot
    // survive a flip, and every chart keeps a fixed series list.
    instance.setOption(merged, { lazyUpdate: true });
  }, [merged]);

  const cssHeight = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      ref={containerRef}
      role={ariaLabel === undefined ? undefined : 'img'}
      aria-label={ariaLabel}
      className={`w-full ${className}`}
      style={{ height: cssHeight }}
    />
  );
}

/** Skeleton placeholder shown while the first series is loading. */
export function ChartSkeleton({ height = 220 }: { height?: number }): ReactNode {
  return <div className="skeleton w-full" style={{ height }} aria-hidden="true" />;
}
