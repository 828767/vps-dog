import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Badge, StatusDot } from './Badge';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';
import { IconArrowRight, IconClock, IconGlobe } from './icons';
import type { LayoutMode } from './ViewModeSwitches';
import { duration, number, relativeTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useNow, useUptimeLive } from '../lib/useLive';
import type { UptimeMonitor } from '../lib/types';

/** Inner tile chrome, same level as the server card's metric tiles. */
const TILE = 'rounded-xl border border-border/70 bg-surface-2/50';

/** Percentage of successful checks; -1 means "no data in this window". */
function rateText(value: number): string {
  return value < 0 ? '–' : `${number(value, 2)}%`;
}

/** Green when up, red when down, grey before the first check. */
function toneFor(monitor: UptimeMonitor): 'success' | 'danger' | 'muted' {
  if (monitor.last_checked === 0) return 'muted';
  return monitor.ok ? 'success' : 'danger';
}

/**
 * Availability is the inverse of a usage meter: 100% is good, not dangerous.
 * `ProgressBar` derives its colour from a "higher is worse" threshold, so the
 * tone has to be passed explicitly here or a perfect uptime renders red.
 */
function availabilityTone(value: number): 'success' | 'warn' | 'danger' | 'muted' {
  if (value < 0) return 'muted';
  if (value >= 99) return 'success';
  if (value >= 95) return 'warn';
  return 'danger';
}

/** One compact metric tile: label, big value, optional bar. */
function MetricTile({
  label,
  value,
  percent,
  tone,
  hint,
}: {
  label: string;
  value: string;
  percent?: number;
  tone?: 'success' | 'warn' | 'danger' | 'muted';
  hint?: string;
}): ReactNode {
  return (
    <div className={`flex min-w-0 flex-col gap-1 px-3 py-2 ${TILE}`}>
      <span className="truncate text-[11px] text-muted">{label}</span>
      <span className="num truncate text-lg leading-none font-semibold text-text">{value}</span>
      {percent !== undefined ? (
        <ProgressBar
          value={Math.max(0, Math.min(100, percent))}
          showValue={false}
          tone={tone}
        />
      ) : null}
      {hint !== undefined ? (
        <span className="num truncate text-[10px] text-muted/85" title={hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export interface UptimeCardProps {
  monitor: UptimeMonitor;
  /** Detailed = full card; compact = square tile with the essentials only. */
  layout: LayoutMode;
}

/**
 * One website monitor on the dashboard — the same card language as `NodeCard`,
 * so a monitor reads as a first-class entity rather than a row in a list.
 *
 * The header links to `/uptime/:id`, where the check history lives; the card
 * itself only carries the live summary, which keeps the dashboard payload small
 * no matter how many monitors exist.
 */
export function UptimeCard({ monitor, layout }: UptimeCardProps): ReactNode {
  const { t, lang } = useI18n();
  const now = useNow(5_000);
  const compact = layout === 'compact';
  const tone = toneFor(monitor);
  const checked = monitor.last_checked > 0;
  const label = !checked ? t('uptime.unknown') : monitor.ok ? t('uptime.up') : t('uptime.down');
  const statusCode =
    monitor.last_status > 0 ? String(monitor.last_status) : checked ? t('uptime.noResponse') : '–';

  if (compact) {
    return (
      <Link
        to={`/uptime/${monitor.id}`}
        className="card flex aspect-square flex-col gap-2 overflow-hidden p-3 transition-colors duration-150 hover:border-accent/40"
      >
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
            <IconGlobe className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{monitor.name}</span>
          <StatusDot online={monitor.ok && checked} label={label} size="sm" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2 py-1">
          <div className="flex flex-col gap-1.5">
            <span className="num text-2xl leading-none font-semibold text-text">
              {rateText(monitor.uptime_24h)}
            </span>
            <span className="text-[11px] text-muted">{t('uptime.uptime24h')}</span>
            <ProgressBar
              value={monitor.uptime_24h < 0 ? 0 : Math.min(100, monitor.uptime_24h)}
              showValue={false}
              tone={availabilityTone(monitor.uptime_24h)}
            />
          </div>
          {/* Two supporting facts keep the square tile from reading as empty. */}
          <div className="flex flex-col gap-1">
            <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
              <span className="truncate">{t('uptime.uptime7d')}</span>
              <span className="num shrink-0 text-text/85">{rateText(monitor.uptime_7d)}</span>
            </span>
            <span className="flex items-center justify-between gap-2 text-[11px] text-muted">
              <span className="truncate">{t('uptime.latency')}</span>
              <span className="num shrink-0 text-text/85">
                {monitor.avg_latency_24h >= 0 ? `${Math.round(monitor.avg_latency_24h)} ms` : '–'}
              </span>
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <Badge tone={tone} dot>
            {statusCode}
          </Badge>
          <span className="num truncate">
            {checked ? relativeTime(monitor.last_checked, now, lang) : '–'}
          </span>
        </div>
      </Link>
    );
  }

  return (
    <article className="card flex flex-col overflow-hidden">
      <Link
        to={`/uptime/${monitor.id}`}
        className="flex min-w-0 items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-surface-2/40"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
          <IconGlobe className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <StatusDot online={monitor.ok && checked} label={label} />
            <span className="min-w-0 truncate text-[15px] font-semibold text-text">{monitor.name}</span>
            <Badge tone={tone} dot>
              {label}
            </Badge>
          </div>
          <span className="truncate font-mono text-[11px] text-muted">{monitor.url}</span>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <Badge tone={tone}>{statusCode}</Badge>
          <span className="flex size-7 items-center justify-center rounded-full border border-border text-muted">
            <IconArrowRight className="size-3.5" />
          </span>
        </span>
      </Link>

      <div className="grid grid-cols-3 gap-2.5 px-5 pb-4">
        <MetricTile
          label={t('uptime.uptime24h')}
          value={rateText(monitor.uptime_24h)}
          percent={monitor.uptime_24h < 0 ? 0 : monitor.uptime_24h}
          tone={availabilityTone(monitor.uptime_24h)}
          hint={`${monitor.checks_24h} ${t('uptime.checks')}`}
        />
        <MetricTile
          label={t('uptime.uptime7d')}
          value={rateText(monitor.uptime_7d)}
          percent={monitor.uptime_7d < 0 ? 0 : monitor.uptime_7d}
          tone={availabilityTone(monitor.uptime_7d)}
        />
        <MetricTile
          label={t('uptime.latency')}
          value={monitor.avg_latency_24h >= 0 ? `${Math.round(monitor.avg_latency_24h)} ms` : '–'}
          hint={checked ? `HTTP ${monitor.last_status > 0 ? monitor.last_status : '—'}` : t('uptime.never')}
        />
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-2.5 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <IconClock className="size-3.5" />
          {t('admin.uptime.lastCheck')}
          <span className="num text-text/85">
            {checked ? relativeTime(monitor.last_checked, now, lang) : t('uptime.never')}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5">
            {t('uptime.interval')}
            <span className="num text-text/85">{duration(monitor.interval, 1, lang)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            {t('uptime.expectedStatus')}
            <span className="num text-text/85">{monitor.expected_status}</span>
          </span>
          <Link to={`/uptime/${monitor.id}`}>
            <Button size="pill" variant="pill" icon={<IconArrowRight className="size-3.5" />}>
              {t('common.viewDetails')}
            </Button>
          </Link>
        </span>
      </div>
    </article>
  );
}

/** Loading placeholder matching the card's rhythm. */
export function UptimeCardSkeleton({ layout }: { layout: LayoutMode }): ReactNode {
  if (layout === 'compact') {
    return <div className="card skeleton aspect-square" aria-hidden="true" />;
  }
  return (
    <div className="card flex flex-col gap-4 p-5" aria-hidden="true">
      <div className="flex items-center gap-3">
        <div className="skeleton size-9 rounded-xl" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="skeleton h-4 w-40" />
          <div className="skeleton h-3 w-64" />
        </div>
        <div className="skeleton h-5 w-12" />
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton h-16" />
        ))}
      </div>
    </div>
  );
}

export interface UptimePanelProps {
  /** Mirrors the dashboard's card layout switch. */
  layout: LayoutMode;
}

/**
 * Dashboard section listing every website monitor as its own card.
 *
 * Renders nothing until at least one monitor exists, so a fresh install keeps
 * its original layout instead of showing an empty section.
 */
export function UptimePanel({ layout }: UptimePanelProps): ReactNode {
  const { t } = useI18n();
  const { data, isPending } = useUptimeLive();

  const monitors = data?.monitors ?? [];
  if (!isPending && monitors.length === 0) return null;

  const total = data?.summary.total ?? 0;
  const up = data?.summary.up ?? 0;
  const allUp = total > 0 && up === total;
  const compact = layout === 'compact';

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <IconGlobe className="size-4 text-muted" />
          {t('uptime.boardTitle')}
          <span className="text-[11px] font-normal text-muted">{monitors.length}</span>
        </h2>
        {isPending ? null : (
          <Badge tone={allUp ? 'success' : total === 0 ? 'muted' : 'danger'} dot>
            {allUp ? t('uptime.allUp') : `${up}/${total}`}
          </Badge>
        )}
      </header>

      <div
        className={
          compact
            ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
            : 'flex flex-col gap-4'
        }
      >
        {isPending
          ? [0, 1].map((index) => <UptimeCardSkeleton key={index} layout={layout} />)
          : monitors.map((monitor) => (
              <UptimeCard key={monitor.id} monitor={monitor} layout={layout} />
            ))}
      </div>
    </section>
  );
}
