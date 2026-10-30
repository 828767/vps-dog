import { Link } from 'react-router-dom';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Badge, StatusDot } from './Badge';
import { Button } from './Button';
import { Chart, ChartSkeleton, lineSeries } from './Chart';
import { CountryFlag } from './CountryFlag';
import { Donut } from './Donut';
import { type LayoutMode, type MeterStyle } from './ViewModeSwitches';
import { IconBellOff } from './icons';
import { ProgressBar } from './ProgressBar';
import { RangeSwitch, type RangeHours } from './RangeSwitch';
import {
  IconArrowRight,
  IconCalendar,
  IconChart,
  IconChevronDown,
  IconChevronUp,
  IconChipSmall,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDisk,
  IconDownload,
  IconLayers,
  IconMemory,
  IconNetworkCard,
  IconRefresh,
  IconUpload,
} from './icons';
import { bytes, cssVar, daysUntil, duration, number, quota, rate, ratioPercent, relativeTime, thresholdTone, toneColor } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useNodeMetrics, useNow } from '../lib/useLive';
import type { MetricPoint, NodeSummary } from '../lib/types';

/** Inner tile chrome — one level up from the card it sits in. */
const TILE = 'rounded-xl border border-border/70 bg-surface-2/50';

/** Interpunct separator for the meta strip; leads its fact, never dangles. */
function Dot(): ReactNode {
  return <span aria-hidden="true">·</span>;
}

/**
 * Sum of *positive* deltas of a cumulative counter, ignoring resets.
 * `net_in`/`net_out` restart at 0 when the host reboots, so a naive
 * `last - first` can go negative or wildly overcount.
 */
function counterDelta(
  points: ReadonlyArray<MetricPoint>,
  pick: (point: MetricPoint) => number,
  fromTs = 0,
): number {
  let sum = 0;
  let previous: number | null = null;
  for (const point of points) {
    const value = pick(point);
    if (previous !== null && point.ts >= fromTs) sum += Math.max(0, value - previous);
    previous = value;
  }
  return sum;
}

function MetricTile({
  icon,
  label,
  value,
  percent,
  hints = [],
  mode = 'bar',
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  percent: number;
  /** Detail lines under the value: usage first, hardware config second. */
  hints?: readonly string[];
  mode?: MeterStyle;
  /** Narrow, height-constrained card: smaller chrome and ring. */
  compact?: boolean;
}): ReactNode {
  // Ring mode sweeps from 0 to its value on mount (the Donut's CSS transition
  // does the animating); updates afterwards morph in place.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const ringPercent = armed ? Math.max(0, Math.min(100, percent)) : 0;
  const ringColor = toneColor(thresholdTone(percent));

  if (mode === 'ring') {
    return (
      <div
        className={`flex h-full min-h-0 flex-col items-center text-center ${TILE} ${
          compact ? 'gap-1 p-2' : 'gap-2 p-3'
        }`}
      >
        <div className="flex w-full items-center gap-2">
          <span
            className={`flex shrink-0 items-center justify-center rounded-lg bg-success/12 text-success ${
              compact ? 'size-6' : 'size-7'
            }`}
          >
            {icon}
          </span>
          <span className="min-w-0 truncate text-[11px] text-muted">{label}</span>
        </div>
        {/* `min-h-0` lets this box shrink inside a height-constrained (square)
            card; the ring itself is capped by the available height so it is
            never clipped by the card's `overflow-hidden`. */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Donut
            size={compact ? 58 : 72}
            thickness={compact ? 7 : 8}
            ariaLabel={`${label}: ${value}`}
            // Two slices: the value arc plus a transparent remainder. A single
            // slice is always its own total, i.e. a perpetually full ring.
            slices={[
              { label, value: ringPercent, color: ringColor },
              { label: `${label}-rest`, value: 100 - ringPercent, color: 'transparent' },
            ]}
            centerBottom={<span className="num text-[11px] font-semibold text-text">{value}</span>}
          />
        </div>
        {hints.length > 0 ? (
          <span className="flex w-full flex-col gap-0.5">
            {hints.map((line) => (
              <span key={line} className="num truncate text-[10px] text-muted/85" title={line}>
                {line}
              </span>
            ))}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    // Bar mode: one compact wide row per metric — icon, label and the detail
    // line on the left, the big value right-aligned, the bar spanning
    // underneath. Deliberately tight vertically: three stacked rows must not
    // grow the panel taller than ring mode's single row.
    <div className={`flex h-full min-h-11 flex-col justify-center gap-1.5 px-3.5 py-1.5 ${TILE}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-success/12 text-success">
          {icon}
        </span>
        <span className="shrink-0 text-[11px] text-muted">{label}</span>
        {hints.length > 0 ? (
          <span className="num min-w-0 truncate text-[11px] text-muted/85" title={hints.join(' · ')}>
            {hints.join(' · ')}
          </span>
        ) : null}
        <span className="num ml-auto shrink-0 text-lg leading-none font-semibold text-text">{value}</span>
      </div>
      <ProgressBar value={percent} showValue={false} />
    </div>
  );
}

function RateCell({
  icon,
  label,
  value,
  hint,
  tone,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: 'success' | 'accent';
  /** Narrow-column rendering: tighter chrome. */
  compact?: boolean;
}): ReactNode {
  const toneClass = tone === 'success' ? 'text-success' : 'text-accent';
  return (
    <div className={`flex items-center ${compact ? 'gap-2 px-2.5 py-1.5' : 'gap-2.5 px-3 py-2'}`}>
      <span className={`shrink-0 ${toneClass}`}>{icon}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] text-muted">{label}</span>
        <span className="num truncate text-sm font-semibold text-text">{value}</span>
        {hint !== undefined ? (
          <span className="num truncate text-[11px] text-muted/85" title={hint}>
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function TrafficCell({
  icon,
  label,
  down,
  up,
  downLabel,
  upLabel,
  tone,
  title,
  compact = false,
  arrows = true,
}: {
  icon: ReactNode;
  label: string;
  down: string;
  up?: string;
  /** Narrow-column rendering: tighter chrome, no wrapping. */
  compact?: boolean;
  /** Hide the ↓/↑ glyphs; quota comparisons are not traffic directions. */
  arrows?: boolean;
  /** Override the ↓/↑ prefixes (the quota cell shows "left" and "share"). */
  downLabel?: string;
  upLabel?: string;
  /** Colours the numbers when the quota is running low / exhausted. */
  tone?: 'warn' | 'danger';
  title?: string;
}): ReactNode {
  const toneClass =
    tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-text';
  return (
    <div
      className={`flex items-center gap-3 ${compact ? 'min-w-0 flex-col items-start gap-1 px-2.5 py-2' : 'px-5 py-3'}`}
      title={title}
    >
      {compact ? null : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[11px] text-muted">{label}</span>
        <div
          className={`flex flex-wrap items-center whitespace-nowrap ${
            compact ? 'gap-x-2 gap-y-0.5 text-[11px]' : 'gap-x-3 gap-y-0.5 text-xs'
          }`}
        >
        
          <span className={`num flex items-center gap-1 ${toneClass}`}>
            {arrows && downLabel === undefined ? (
              <span className="text-success" aria-hidden="true">
                ↓
              </span>
            ) : null}
            {down}
            {downLabel !== undefined ? (
              <span className="text-muted">{downLabel}</span>
            ) : null}
          </span>
          {up !== undefined ? (
            <span className={`num flex items-center gap-1 ${toneClass}`}>
              {arrows && upLabel === undefined ? (
                <span className="text-accent" aria-hidden="true">
                  ↑
                </span>
              ) : null}
              {up}
              {upLabel !== undefined ? <span className="text-muted">{upLabel}</span> : null}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Legend row for the traffic donut: dot, label, total, share. */
function LegendRow({
  color,
  label,
  total,
  share,
}: {
  color: string;
  label: string;
  total: string;
  share: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
      <span className="num shrink-0 font-medium text-text">{total}</span>
      <span className="num w-11 shrink-0 text-right text-muted">{share}</span>
    </div>
  );
}

export interface NodeCardProps {
  node: NodeSummary;
  /** Detailed shows the full card; compact drops to meters + rates only. */
  layout: LayoutMode;
  /** How the CPU / memory / disk tiles draw their meter. */
  meterStyle: MeterStyle;
  /** Cards start open; collapse state is local to the card. */
  defaultExpanded?: boolean;
}

/**
 * One server on the dashboard: identity, live meters, a traffic chart and the
 * traffic totals, collapsible.
 *
 * The per-node history is only requested while the card is open, so a collapsed
 * node costs no extra round trip.
 */
export function NodeCard({
  node,
  layout,
  meterStyle,
  defaultExpanded = true,
}: NodeCardProps): ReactNode {
  const { t, lang } = useI18n();
  const now = useNow(5_000);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hours, setHours] = useState<RangeHours>(1);
  const panelId = useId();

  const online = node.online === true;
  const metrics = node.metrics;
  // Compact keeps the meters and rates only; the chart, ratio donut and
  // protocol panel are dropped so a fleet reads as one scannable list. The
  // meter style (bars or rings) applies in both layouts.
  const compact = layout === 'compact';
  const tileMode: MeterStyle = meterStyle;

  const chartQuery = useNodeMetrics(expanded ? node.id : undefined, hours);
  const dayQuery = useNodeMetrics(expanded ? node.id : undefined, 24);

  const cpu = online && metrics !== null ? metrics.cpu : 0;
  const memPercent = online && metrics !== null ? ratioPercent(metrics.mem_used, metrics.mem_total) : 0;
  const diskPercent =
    online && metrics !== null ? ratioPercent(metrics.disk_used, metrics.disk_total) : 0;

  // Detail lines for the three tiles: usage first, hardware config second.
  // `host` is absent on older workers and until the agent's first report.
  const cpuHints: string[] = [];
  if (online && metrics !== null) {
    cpuHints.push(`${t('node.load1.short')} ${number(metrics.load1, 2)}`);
  }
  const hostInfo = node.host ?? null;
  if (hostInfo !== null && hostInfo.cpu_cores > 0) {
    const cores = t('node.cpuCores', { n: hostInfo.cpu_cores });
    cpuHints.push(hostInfo.cpu_model.length > 0 ? `${cores} · ${hostInfo.cpu_model}` : cores);
  }
  const usageHint = (used: number, total: number): string =>
    total > 0 ? `${bytes(used)} / ${bytes(total)}` : bytes(used);
  const memHints = online && metrics !== null ? [usageHint(metrics.mem_used, metrics.mem_total)] : [];
  const diskHints =
    online && metrics !== null ? [usageHint(metrics.disk_used, metrics.disk_total)] : [];

  const netIn = metrics !== null ? metrics.net_in : 0;
  const netOut = metrics !== null ? metrics.net_out : 0;
  const netTotal = netIn + netOut;
  const downShare = netTotal > 0 ? (netIn / netTotal) * 100 : 0;
  const upShare = netTotal > 0 ? (netOut / netTotal) * 100 : 0;

  const dayPoints = dayQuery.data?.points ?? [];
  const startOfToday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }, [now]);

  const todayIn = counterDelta(dayPoints, (p) => p.net_in, startOfToday);
  const todayOut = counterDelta(dayPoints, (p) => p.net_out, startOfToday);

  // Remaining quota for the current month. `traffic_used` is the worker's
  // metered month-to-date figure including any operator correction; falling
  // back to the raw counters keeps older workers working.
  const fallbackUsed =
    node.traffic_both === false
      ? (node.traffic_month_out ?? 0)
      : (node.traffic_month_in ?? 0) + (node.traffic_month_out ?? 0);
  const usedThisMonth = node.traffic_used ?? fallbackUsed;
  const quotaBytes = node.traffic_gb > 0 ? node.traffic_gb * 1024 ** 3 : 0;
  const remaining = quotaBytes > 0 ? quotaBytes - usedThisMonth : 0;
  const remainingPercent = quotaBytes > 0 ? (remaining / quotaBytes) * 100 : 0;
  const overQuota = quotaBytes > 0 && remaining <= 0;

  const chartOption = useMemo(() => {
    const points = chartQuery.data?.points ?? [];
    const toPairs = (pick: (point: MetricPoint) => number): Array<[number, number]> =>
      points.filter((point) => Number.isFinite(pick(point))).map((point) => [point.ts * 1000, pick(point)]);
    return {
      xAxis: {
        axisLabel: {
          formatter: (value: number) => {
            const d = new Date(value);
            const pad = (n: number) => String(n).padStart(2, '0');
            return hours > 24
              ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
              : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
          },
        },
      },
      yAxis: { axisLabel: { formatter: (value: number) => `${value} B/s` } },
      tooltip: { valueFormatter: (value: unknown) => rate(Number(value)) },
      series: [
        lineSeries(t('node.rx'), toPairs((p) => p.rx_rate), cssVar('--success', '#1cf8ba')),
        lineSeries(t('node.tx'), toPairs((p) => p.tx_rate), cssVar('--accent', '#0092ff')),
      ],
    };
  }, [chartQuery.data, hours, t]);

  const statusLabel = online ? t('status.short.ok') : t('status.offline');
  // The agent reports `os` and `arch` as tags; show the OS one.
  const osTag = node.tags.find((tag) => !/^(x86|arm|aarch|amd|i[3-6]86)/i.test(tag)) ?? '';

  return (
    <article
      className={`card overflow-hidden ${compact ? 'flex aspect-square flex-col' : ''}`}
    >
      {/* ── header ── */}
      <h3 className="flex items-center">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className={`flex min-w-0 flex-1 items-center gap-3 text-left transition-colors duration-150 hover:bg-surface-2/40 ${
            compact ? 'px-3 py-2.5' : 'px-5 py-3.5'
          }`}
        >
          <StatusDot online={online} label={statusLabel} />
          <span className="min-w-0 truncate text-[15px] font-semibold text-text">{node.name}</span>
          <Badge tone={online ? 'success' : 'muted'} dot>
            {statusLabel}
          </Badge>
          {/* Country and OS ride on the name row; the rest of the facts stay on
              the meta strip below. */}
          {node.country.length > 0 ? (
            <span
              className="flex shrink-0 items-center gap-1 text-[11px] text-muted"
              title={node.ip.length > 0 ? `${t('node.ip')} ${node.ip}` : undefined}
            >
              <CountryFlag code={node.country} className="text-[13px]" />
              <span className="num">{node.country}</span>
            </span>
          ) : node.ip.length > 0 ? (
            <span className="num shrink-0 text-[11px] text-muted">{node.ip}</span>
          ) : null}
          {osTag.length > 0 ? (
            <span className="min-w-0 truncate text-[11px] text-muted">{osTag}</span>
          ) : null}
          {node.notify === false ? (
            <span title={t('node.notifyOff')} className="shrink-0 text-muted">
              <IconBellOff className="size-3.5" />
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <span className="sr-only">{expanded ? t('common.collapse') : t('common.expand')}</span>
            <span className="flex size-7 items-center justify-center rounded-full border border-border text-muted">
              {expanded ? <IconChevronUp /> : <IconChevronDown />}
            </span>
          </span>
        </button>
      </h3>

      {/* ── meta strip ──
          Separators lead each fact rather than trail it, so a fact that is
          absent (no OS tag, no price, compact layout) never leaves a dangling
          "·" behind. */}
      <div
        className={`flex items-center text-[11px] text-muted ${
          compact ? 'gap-x-2 overflow-hidden px-3 pb-2.5' : 'flex-wrap gap-x-3 gap-y-1 px-5 pb-3.5'
        }`}
      >
        {compact ? null : <IconRefresh className="size-3.5 shrink-0 text-success" />}

        {/* Uptime is dropped in compact (narrow column), everything else stays
            available in both layouts — an expiry date the operator set must not
            silently disappear just because the card is small. */}
        {compact ? null : (
          <span className="flex items-center gap-1.5">
            <span>{t('node.uptime')}</span>
            <span className="num text-text/85">{online ? duration(node.uptime, 2, lang) : '–'}</span>
          </span>
        )}

        {node.price.length > 0 ? (
          <>
            <Dot />
            {/* Plain font: the price is free-form operator text (often CJK),
                which the tabular `num` face has no glyphs for. */}
            <span className="shrink-0 whitespace-nowrap text-text/85">{node.price}</span>
          </>
        ) : null}

        {node.traffic_gb > 0 ? (
          <>
            <Dot />
            <span className="flex shrink-0 items-center gap-1.5">
              <span>{t('node.trafficQuota')}</span>
              <span className="num text-text/85">{quota(node.traffic_gb)}</span>
            </span>
          </>
        ) : null}

        {node.expires_at.length > 0 ? (
          <>
            <Dot />
            <span className="flex shrink-0 items-center gap-1.5">
              <span>{t('node.expires')}</span>
              <span
                className={`num ${
                  daysUntil(node.expires_at, now) <= 0
                    ? 'font-semibold text-danger'
                    : daysUntil(node.expires_at, now) <= 30
                      ? 'text-warn'
                      : 'text-text/85'
                }`}
              >
                {node.expires_at}
              </span>
            </span>
          </>
        ) : null}

        <Dot />
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <span>{t('node.lastSeen')}</span>
          <span className="num text-text/85">{relativeTime(node.last_seen, now, lang)}</span>
        </span>
      </div>

      {expanded ? (
        <div
          id={panelId}
          className={`flex flex-col border-t border-border/60 ${
            compact ? 'flex-1 justify-center gap-2.5 p-2.5' : 'gap-4 p-5'
          }`}
        >
          <div
            className={`grid grid-cols-1 gap-4 ${
              compact ? '' : 'xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1.75fr)_minmax(0,1fr)]'
            }`}
          >
            {/* ── meters ──
                The tiles stretch to fill the column so the panel is never
                shorter than the chart / donut beside it; the rate row keeps
                its natural (compact) height. */}
            <div className="flex min-h-0 flex-col gap-2.5">
              {/* Bar mode stacks the three metrics vertically (each a wide
                  row); ring mode keeps them side by side. */}
              <div
                className={`grid min-h-0 flex-1 gap-2.5 ${
                  meterStyle === 'ring' ? 'grid-cols-3' : 'grid-cols-1'
                }`}
              >
                <MetricTile
                  mode={tileMode}
                  compact={compact}
                  icon={<IconCpu className="size-4" />}
                  label={t('node.cpu')}
                  value={`${number(cpu, 1)}%`}
                  percent={cpu}
                  hints={cpuHints}
                />
                <MetricTile
                  mode={tileMode}
                  compact={compact}
                  icon={<IconMemory className="size-4" />}
                  label={t('node.mem')}
                  value={`${number(memPercent, 1)}%`}
                  percent={memPercent}
                  hints={memHints}
                />
                <MetricTile
                  mode={tileMode}
                  compact={compact}
                  icon={<IconDisk className="size-4" />}
                  label={t('node.disk')}
                  value={`${number(diskPercent, 1)}%`}
                  percent={diskPercent}
                  hints={diskHints}
                />
              </div>
              <div className={`grid flex-none grid-cols-2 divide-x divide-border/70 ${TILE}`}>
                <RateCell
                  icon={<IconDownload className="size-5" />}
                  label={t('node.rx')}
                  value={rate(metrics?.rx_rate)}
                  hint={metrics !== null ? `Σ ${bytes(metrics.net_in)}` : undefined}
                  tone="success"
                  compact={compact}
                />
                <RateCell
                  icon={<IconUpload className="size-5" />}
                  label={t('node.tx')}
                  value={rate(metrics?.tx_rate)}
                  hint={metrics !== null ? `Σ ${bytes(metrics.net_out)}` : undefined}
                  tone="accent"
                  compact={compact}
                />
              </div>
            </div>

            {/* ── traffic chart ── (omitted entirely in compact) */}
            {compact ? null : (
            <section className={`flex flex-col gap-2 p-3 ${TILE}`}>
              <header className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <IconChart className="size-4 text-success" />
                  <span className="text-sm font-semibold text-text">
                    {t('dashboard.trafficStats')}
                  </span>
                </span>
                <RangeSwitch value={hours} onChange={setHours} size="sm" />
              </header>
              {chartQuery.isPending ? (
                <ChartSkeleton height={168} />
              ) : (
                <Chart option={chartOption} height={168} ariaLabel={t('dashboard.trafficStats')} />
              )}
              <div className="flex items-center gap-4 px-1 text-[11px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-success" aria-hidden="true" />
                  {t('node.rx')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
                  {t('node.tx')}
                </span>
              </div>
            </section>
            )}

            {/* ── split + protocol ── (omitted entirely in compact) */}
            {compact ? null : (
            <div className="flex flex-col gap-2.5">
              <section className={`flex items-center gap-3 p-3 ${TILE}`}>
                <Donut
                  size={96}
                  thickness={11}
                  ariaLabel={`${t('dashboard.upDownRatio')}: ${number(downShare, 1)}% / ${number(upShare, 1)}%`}
                  slices={[
                    { label: t('node.rx'), value: netIn, color: cssVar('--success', '#1cf8ba') },
                    { label: t('node.tx'), value: netOut, color: cssVar('--accent', '#0092ff') },
                  ]}
                  centerTop={
                    <span className="text-[10px] leading-tight text-muted">
                      {t('dashboard.upDownRatio')}
                    </span>
                  }
                  centerBottom={
                    netTotal > 0 ? (
                      <span className="num text-[11px] font-semibold text-text">
                        {number(downShare, 0)}/{number(upShare, 0)}%
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted">{t('common.noData')}</span>
                    )
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <LegendRow
                    color={cssVar('--success', '#1cf8ba')}
                    label={t('node.rx')}
                    total={bytes(netIn)}
                    share={`${number(downShare, 1)}%`}
                  />
                  <LegendRow
                    color={cssVar('--accent', '#0092ff')}
                    label={t('node.tx')}
                    total={bytes(netOut)}
                    share={`${number(upShare, 1)}%`}
                  />
                </div>
              </section>

              <section className={`flex flex-col gap-2 p-3 ${TILE}`}>
                <span className="text-sm font-semibold text-text">
                  {t('dashboard.protocolShare')}
                </span>
                {/* The agent reports connection counts, not per-protocol bytes,
                    so there is nothing truthful to chart here yet. */}
                <div className="flex flex-col gap-1.5">
                  {[
                    { icon: <IconLayers className="size-4" />, label: t('protocol.tcp') },
                    { icon: <IconNetworkCard className="size-4" />, label: t('protocol.udp') },
                    { icon: <IconChipSmall className="size-4" />, label: t('protocol.other') },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center gap-2.5 text-[11px]">
                      <span className="text-muted">{row.icon}</span>
                      <span className="w-9 shrink-0 text-muted">{row.label}</span>
                      <span className="h-1.5 flex-1 rounded-full bg-surface-2" aria-hidden="true" />
                      <span className="num w-10 shrink-0 text-right text-muted">–</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted/80">{t('common.noData')}</p>
              </section>
            </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ── totals ──
          Three facts side by side in both layouts; compact just uses tighter
          cells and drops the trailing "details" column. */}
      <div
        className={`grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 ${
          compact ? '' : 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]'
        }`}
      >
        <TrafficCell
          icon={<IconCalendar className="size-4" />}
          label={t('dashboard.todayTraffic')}
          down={bytes(todayIn)}
          up={bytes(todayOut)}
          compact={compact}
        />
        <TrafficCell
          icon={<IconDatabase className="size-4" />}
          compact={compact}
          label={t('dashboard.usedTraffic')}
          down={quotaBytes > 0 ? bytes(usedThisMonth) : bytes(netIn + netOut)}
          up={quotaBytes > 0 ? quota(node.traffic_gb) : undefined}
          downLabel={quotaBytes > 0 ? t('dashboard.usedOf') : undefined}
          arrows={!compact}
          title={
            node.traffic_corrected === true
              ? `${t('dashboard.quotaUsed')}: ${bytes(usedThisMonth)}${
                  quotaBytes > 0 ? ` / ${quota(node.traffic_gb)}` : ''
                } (${t('dashboard.quotaCorrected')})`
              : undefined
          }
        />
        <TrafficCell
          icon={<IconClock className="size-4" />}
          label={
            node.traffic_corrected === true
              ? `${t('dashboard.remainingTraffic')} · ${t('dashboard.quotaCorrectedShort')}`
              : t('dashboard.remainingTraffic')
          }
          down={quotaBytes > 0 ? bytes(Math.max(0, remaining)) : '–'}
          up={
            compact
              ? undefined
              : quotaBytes > 0
                ? `${number(Math.max(0, remainingPercent), 0)}%`
                : t('dashboard.noQuota')
          }
          downLabel={compact ? undefined : t('dashboard.remainingLeft')}
          upLabel={t('dashboard.remainingShare')}
          tone={overQuota ? 'danger' : quotaBytes > 0 && remainingPercent < 20 ? 'warn' : undefined}
          arrows={!compact}
          compact={compact}
          title={
            quotaBytes > 0
              ? `${t('dashboard.remainingTraffic')}: ${bytes(Math.max(0, remaining))} (${number(
                  Math.max(0, remainingPercent),
                  0,
                )}% ${t('dashboard.remainingShare')})`
              : undefined
          }
        />
        {compact ? null : (
        <div className="flex items-center justify-end px-5 py-3">
          <Link to={`/node/${node.id}`}>
            <Button size="pill" variant="pill" icon={<IconArrowRight className="size-3.5" />}>
              {t('common.viewDetails')}
            </Button>
          </Link>
        </div>
        )}
      </div>
    </article>
  );
}

/** Loading placeholder matching the card's rhythm. */
export function NodeCardSkeleton(): ReactNode {
  return (
    <div className="card flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3">
        <div className="skeleton size-2.5 rounded-full" />
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-4 w-16" />
      </div>
      <div className="skeleton h-3 w-64" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,2.1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2.5">
          <div className="grid flex-1 grid-cols-3 gap-2.5">
            {[0, 1, 2].map((index) => (
              <div key={index} className="skeleton h-full min-h-24" />
            ))}
          </div>
          <div className="skeleton min-h-20 flex-1" />
        </div>
        <div className="skeleton h-52" />
        <div className="skeleton h-52" />
      </div>
    </div>
  );
}
