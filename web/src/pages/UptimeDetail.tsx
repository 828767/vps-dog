import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import { Badge, StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { Chart, ChartSkeleton, lineSeries } from '../components/Chart';
import { EmptyState } from '../components/EmptyState';
import { Notice } from '../components/Notice';
import { StatCard } from '../components/StatCard';
import { Table, type Column } from '../components/Table';
import { IconActivity, IconClock, IconGlobe } from '../components/icons';
import { ApiError, errorMessage } from '../lib/api';
import { cssVar, dateTime, duration, number, relativeTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useNow, useUptimeDetail } from '../lib/useLive';
import type { UptimeCheckPoint } from '../lib/types';

/** Newest-first from the API; charts want chronological order. */
function chronological(checks: ReadonlyArray<UptimeCheckPoint>): UptimeCheckPoint[] {
  return [...checks].sort((a, b) => a.ts - b.ts);
}

function rateText(value: number): string {
  return value < 0 ? '–' : `${number(value, 2)}%`;
}

/** Green/red bar strip of the most recent checks, oldest on the left. */
function Timeline({ checks }: { checks: ReadonlyArray<UptimeCheckPoint> }): ReactNode {
  const { t } = useI18n();
  if (checks.length === 0) {
    return <p className="py-6 text-center text-xs text-muted">{t('uptime.noChecks')}</p>;
  }
  // Bar height tracks response time, so a slow patch is visible at a glance;
  // failures are drawn full height because their latency is not comparable.
  const latencies = checks.filter((check) => check.ok).map((check) => check.latency);
  const max = latencies.length > 0 ? Math.max(...latencies) : 0;
  return (
    <div
      className="flex h-10 items-end gap-px overflow-hidden"
      role="img"
      aria-label={t('uptime.timeline')}
    >
      {checks.map((check) => {
        const ratio = check.ok && max > 0 ? Math.max(0.18, Math.min(1, check.latency / max)) : 1;
        return (
          <span
            key={check.ts}
            title={`${dateTime(check.ts)} · ${check.status > 0 ? `HTTP ${check.status}` : t('uptime.noResponse')} · ${Math.round(check.latency)} ms`}
            className={`min-w-0 flex-1 rounded-[2px] ${check.ok ? 'bg-success/85' : 'bg-danger/85'}`}
            style={{ height: `${Math.round(ratio * 100)}%` }}
          />
        );
      })}
    </div>
  );
}

/** `/uptime/:id` — one website monitor: summary, response time, check history. */
export default function UptimeDetail(): ReactNode {
  const { t, lang } = useI18n();
  const { id } = useParams<{ id: string }>();
  const now = useNow(5_000);
  const detailQuery = useUptimeDetail(id);

  const monitor = detailQuery.data?.monitor;
  const checks = useMemo(() => chronological(detailQuery.data?.checks ?? []), [detailQuery.data]);

  const latencyOption = useMemo<EChartsOption>(() => {
    const points = checks
      .filter((check) => Number.isFinite(check.latency))
      .map((check) => [check.ts * 1000, Math.round(check.latency)] as [number, number]);
    return {
      yAxis: { axisLabel: { formatter: (value: number) => `${value} ms` } },
      tooltip: { valueFormatter: (value: unknown) => `${Math.round(Number(value))} ms` },
      series: [lineSeries(t('uptime.latency'), points, cssVar('--accent', '#0092ff'))],
    };
  }, [checks, t]);

  const columns = useMemo<ReadonlyArray<Column<UptimeCheckPoint>>>(
    () => [
      {
        key: 'time',
        header: t('common.time'),
        render: (row) => <span className="num text-xs text-muted">{dateTime(row.ts)}</span>,
      },
      {
        key: 'status',
        header: t('uptime.statusCode'),
        render: (row) =>
          row.status > 0 ? (
            <Badge tone={row.ok ? 'success' : 'danger'}>{row.status}</Badge>
          ) : (
            <Badge tone="danger">{t('uptime.noResponse')}</Badge>
          ),
      },
      {
        key: 'latency',
        header: t('uptime.latency'),
        align: 'right',
        render: (row) => <span className="num text-xs">{Math.round(row.latency)} ms</span>,
      },
      {
        key: 'result',
        header: t('uptime.result'),
        align: 'right',
        render: (row) =>
          row.ok ? (
            <Badge tone="success" dot>
              {t('uptime.up')}
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              {t('uptime.down')}
            </Badge>
          ),
      },
      {
        key: 'error',
        header: t('common.detail'),
        hideOnMobile: true,
        render: (row) => (
          <span className="block max-w-[22rem] truncate text-[11px] text-muted" title={row.error}>
            {row.error !== '' ? row.error : '—'}
          </span>
        ),
      },
    ],
    [t],
  );

  if (detailQuery.isError) {
    const notFound = detailQuery.error instanceof ApiError && detailQuery.error.isNotFound;
    return (
      <EmptyState
        tone={notFound ? 'default' : 'danger'}
        title={notFound ? t('uptime.notFound') : t('error.title')}
        hint={notFound ? t('uptime.notFoundHint') : errorMessage(detailQuery.error)}
        action={
          <div className="flex gap-2">
            <Link to="/">
              <Button variant="secondary">{t('detail.back')}</Button>
            </Link>
            {notFound ? null : (
              <Button variant="primary" onClick={() => void detailQuery.refetch()}>
                {t('common.retry')}
              </Button>
            )}
          </div>
        }
      />
    );
  }

  if (monitor === undefined) {
    return <EmptyState title={t('uptime.loading')} hint={t('common.loading')} />;
  }

  const checked = monitor.last_checked > 0;
  const tone = !checked ? 'muted' : monitor.ok ? 'success' : 'danger';
  const label = !checked ? t('uptime.unknown') : monitor.ok ? t('uptime.up') : t('uptime.down');
  const failed = checks.filter((check) => !check.ok).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:text-text"
        >
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
            <path
              d="M10 4 6 8l4 4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('detail.back')}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-text">
              <StatusDot online={monitor.ok && checked} label={label} />
              <span className="truncate">{monitor.name}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={tone} dot>
                {label}
              </Badge>
              {checked ? <Badge tone="accent">{monitor.last_status > 0 ? `HTTP ${monitor.last_status}` : t('uptime.noResponse')}</Badge> : null}
              <Badge tone="muted">{monitor.method}</Badge>
              <Badge tone="neutral">
                {t('uptime.expectedStatus')} {monitor.expected_status}
              </Badge>
            </div>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted transition-colors duration-150 hover:text-accent"
            >
              <IconGlobe className="size-3.5 shrink-0" />
              <span className="truncate">{monitor.url}</span>
            </a>
          </div>

          <div className="flex flex-col items-end gap-1 text-right text-[11px] text-muted">
            <span>
              {t('admin.uptime.lastCheck')}:{' '}
              <span className="num">{checked ? relativeTime(monitor.last_checked, now, lang) : t('uptime.never')}</span>
            </span>
            <span className="num">{checked ? dateTime(monitor.last_checked) : '–'}</span>
            <span>
              {t('uptime.interval')}: <span className="num">{duration(monitor.interval, 1, lang)}</span>
            </span>
            <span>
              {t('uptime.timeout')}: <span className="num">{monitor.timeout_ms} ms</span>
            </span>
          </div>
        </div>
      </header>

      {!checked ? <Notice tone="warn">{t('uptime.never')}</Notice> : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('uptime.uptime24h')}
          value={rateText(monitor.uptime_24h)}
          icon={<IconActivity />}
          tone={monitor.uptime_24h >= 0 && monitor.uptime_24h < 100 ? 'warn' : 'success'}
          iconTone={monitor.uptime_24h >= 0 && monitor.uptime_24h < 100 ? 'warn' : 'success'}
          hint={`${monitor.checks_24h} ${t('uptime.checks')}`}
        />
        <StatCard
          label={t('uptime.uptime7d')}
          value={rateText(monitor.uptime_7d)}
          icon={<IconActivity />}
          iconTone="accent"
        />
        <StatCard
          label={t('uptime.avgLatency')}
          value={monitor.avg_latency_24h >= 0 ? `${Math.round(monitor.avg_latency_24h)} ms` : '–'}
          icon={<IconClock />}
          iconTone="accent"
        />
        <StatCard
          label={t('uptime.result')}
          value={monitor.last_status > 0 ? String(monitor.last_status) : '–'}
          icon={<IconGlobe />}
          tone={tone === 'muted' ? 'muted' : tone}
          iconTone={tone === 'muted' ? 'muted' : tone}
          hint={checked ? `${Math.round(monitor.last_latency)} ms` : undefined}
        />
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{t('uptime.latencyTrend')}</h2>
          <span className="text-[11px] text-muted">
            {checks.length > 0
              ? `${checks.length} ${t('uptime.checks')} · ${failed} ${t('uptime.down')}`
              : t('uptime.noChecks')}
          </span>
        </header>
        {detailQuery.isPending ? (
          <ChartSkeleton height={220} />
        ) : checks.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted">{t('uptime.noChecks')}</p>
        ) : (
          <Chart option={latencyOption} height={220} ariaLabel={t('uptime.latencyTrend')} />
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold text-text">{t('uptime.timeline')}</h2>
        <Timeline checks={checks} />
        <p className="text-[11px] text-muted/80">
          {checks.length > 0
            ? `${dateTime(checks[0]!.ts)} → ${dateTime(checks[checks.length - 1]!.ts)}`
            : ''}
        </p>
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h2 className="text-sm font-semibold text-text">{t('uptime.recentChecks')}</h2>
        <Table
          columns={columns}
          rows={[...checks].reverse()}
          rowKey={(row) => String(row.ts)}
          loading={detailQuery.isPending}
          loadingLabel={t('common.loading')}
          empty={<EmptyState compact title={t('uptime.noChecks')} />}
        />
      </section>
    </div>
  );
}
