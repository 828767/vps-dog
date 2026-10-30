import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import { Badge, StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { Chart, ChartSkeleton, lineSeries } from '../components/Chart';
import { EmptyState } from '../components/EmptyState';
import { Gauge } from '../components/Gauge';
import { Notice } from '../components/Notice';
import { RangeSwitch, type RangeHours } from '../components/RangeSwitch';
import { Sparkline } from '../components/Sparkline';
import { Spinner } from '../components/Spinner';
import { StatCard } from '../components/StatCard';
import { Table, type Column } from '../components/Table';
import {
  IconActivity,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDownload,
  IconMemory,
  IconUpload,
} from '../components/icons';
import { ApiError, errorMessage } from '../lib/api';
import {
  axisBytes,
  bytes,
  clockTime,
  cssVar,
  dateTime,
  duration,
  durationLong,
  int,
  ms,
  number,
  percent,
  rate,
  ratioPercent,
  relativeTime,
  shortDateTime,
} from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useNodeLive, useNodeMetrics, useNodePings, useNow } from '../lib/useLive';
import type { MetricPoint, NodeDetail as NodeDetailDto, PingTaskWithSeries } from '../lib/types';

function toPairs(points: ReadonlyArray<MetricPoint>, pick: (point: MetricPoint) => number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const point of points) {
    const value = pick(point);
    if (!Number.isFinite(value)) continue;
    out.push([point.ts * 1000, value]);
  }
  return out;
}

interface ChartCardProps {
  title: string;
  children: ReactNode;
  legend?: ReactNode;
  right?: ReactNode;
}

function ChartCard({ title, children, legend, right }: ChartCardProps): ReactNode {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-text">{title}</h2>
          {legend}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function PingTable({ node }: { node: NodeDetailDto }): ReactNode {
  const { t } = useI18n();
  const pingsQuery = useNodePings(node.id);

  // Prefer the richer `/pings` payload (it carries the series); fall back to the
  // summaries embedded in the node detail response.
  const rows = useMemo<ReadonlyArray<PingTaskWithSeries>>(() => {
    const withSeries = pingsQuery.data?.pings;
    if (withSeries !== undefined && withSeries.length > 0) return withSeries;
    return node.pings.map((ping) => ({ ...ping, series: [] }));
  }, [pingsQuery.data, node.pings]);

  const columns = useMemo<ReadonlyArray<Column<PingTaskWithSeries>>>(
    () => [
      {
        key: 'name',
        header: t('ping.name'),
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-text">{row.name}</span>
            <span className="text-[11px] text-muted">{row.target}</span>
          </div>
        ),
      },
      {
        key: 'type',
        header: t('ping.type'),
        hideOnMobile: true,
        render: (row) => <Badge tone="neutral">{row.type}</Badge>,
      },
      {
        key: 'status',
        header: t('ping.status'),
        render: (row) => {
          const latest = row.latest;
          if (latest === null) {
            return <span className="text-xs text-muted">–</span>;
          }
          return latest.ok ? (
            <Badge tone="success" dot>
              {t('ping.ok')}
            </Badge>
          ) : (
            <Badge tone="danger" dot>
              {t('ping.fail')}
            </Badge>
          );
        },
      },
      {
        key: 'latest',
        header: t('ping.latest'),
        align: 'right',
        render: (row) => (
          <span className="num font-medium text-text">{ms(row.latest?.value)}</span>
        ),
      },
      {
        key: 'avg',
        header: t('ping.avg'),
        align: 'right',
        hideOnMobile: true,
        render: (row) => <span className="num text-muted">{ms(row.avg_24h)}</span>,
      },
      {
        key: 'loss',
        header: t('ping.loss'),
        align: 'right',
        hideOnMobile: true,
        render: (row) => (
          <span className={`num ${row.loss_24h > 0 ? 'text-warn' : 'text-muted'}`}>
            {percent(row.loss_24h, 1)}
          </span>
        ),
      },
      {
        key: 'trend',
        header: t('ping.trend'),
        align: 'right',
        render: (row) => (
          <Sparkline
            values={row.series.map((point) => (point.ok ? point.value : -1))}
            ariaLabel={`${row.name}: ${ms(row.latest?.value)}`}
            stroke={
              row.latest !== null && !row.latest.ok
                ? cssVar('--danger', '#f0506e')
                : cssVar('--accent', '#0092ff')
            }
          />
        ),
      },
    ],
    [t],
  );

  return (
    <section className="card flex flex-col gap-3 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text">{t('detail.pings')}</h2>
          {pingsQuery.isFetching ? <Spinner size={12} className="text-muted" /> : null}
        </div>
        <span className="text-[11px] text-muted">{t('ping.interval')}</span>
      </header>

      {pingsQuery.isError ? (
        <EmptyState
          compact
          tone="danger"
          title={t('error.title')}
          hint={errorMessage(pingsQuery.error)}
          action={
            <Button size="sm" variant="secondary" onClick={() => void pingsQuery.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={pingsQuery.isPending && node.pings.length === 0}
          loadingLabel={t('common.loading')}
          empty={<EmptyState compact title={t('ping.empty')} hint={t('ping.emptyHint')} />}
        />
      )}
    </section>
  );
}

export default function NodeDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const now = useNow(5_000);
  const [hours, setHours] = useState<RangeHours>(1);

  const nodeQuery = useNodeLive(id);
  const metricsQuery = useNodeMetrics(id, hours);
  const node = nodeQuery.data;
  const series = metricsQuery.data;

  const points = series?.points ?? [];

  const options = useMemo<{
    cpuMem: EChartsOption;
    net: EChartsOption;
    load: EChartsOption;
    traffic: EChartsOption;
    disk: EChartsOption;
  }>(() => {
    const accent = cssVar('--accent', '#0092ff');
    const success = cssVar('--success', '#1cf8ba');
    const warn = cssVar('--warn', '#f5a524');
    const danger = cssVar('--danger', '#f0506e');
    const axisLabelFormatter =
      hours > 24
        ? (value: number) => shortDateTime(Math.round(value / 1000))
        : (value: number) => clockTime(Math.round(value / 1000));

    const xAxis = { axisLabel: { formatter: axisLabelFormatter } };

    const cpuMem: EChartsOption = {
      xAxis,
      yAxis: { max: 100, min: 0, axisLabel: { formatter: (value: number) => `${value}%` } },
      legend: { show: true },
      tooltip: {
        valueFormatter: (value) => `${Number(value).toFixed(1)}%`,
      },
      series: [
        lineSeries('CPU', toPairs(points, (point) => point.cpu), accent),
        lineSeries('MEM', toPairs(points, (point) => point.mem_percent), success),
      ],
    };

    const net: EChartsOption = {
      xAxis,
      yAxis: { axisLabel: { formatter: (value: number) => axisBytes(value) } },
      legend: { show: true },
      tooltip: { valueFormatter: (value) => rate(Number(value)) },
      series: [
        lineSeries('↓ RX', toPairs(points, (point) => point.rx_rate), success),
        lineSeries('↑ TX', toPairs(points, (point) => point.tx_rate), accent),
      ],
    };

    const load: EChartsOption = {
      xAxis,
      yAxis: { axisLabel: { formatter: (value: number) => number(value, 1) } },
      legend: { show: true },
      tooltip: { valueFormatter: (value) => number(Number(value), 2) },
      series: [lineSeries(t('node.load1'), toPairs(points, (point) => point.load1), danger)],
    };

    const traffic: EChartsOption = {
      xAxis,
      yAxis: { axisLabel: { formatter: (value: number) => axisBytes(value) } },
      legend: { show: true },
      tooltip: { valueFormatter: (value) => bytes(Number(value), 2) },
      series: [
        lineSeries(t('node.trafficIn'), toPairs(points, (point) => point.net_in), success, {
          area: false,
        }),
        lineSeries(t('node.trafficOut'), toPairs(points, (point) => point.net_out), accent, {
          area: false,
          dashed: true,
        }),
      ],
    };

    const disk: EChartsOption = {
      xAxis,
      yAxis: { max: 100, min: 0, axisLabel: { formatter: (value: number) => `${value}%` } },
      legend: { show: true },
      tooltip: { valueFormatter: (value) => `${Number(value).toFixed(1)}%` },
      series: [lineSeries(t('node.disk'), toPairs(points, (point) => point.disk_percent), warn)],
    };

    return { cpuMem, net, load, traffic, disk };
  }, [points, hours, t]);

  if (nodeQuery.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <div className="skeleton h-6 w-48" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="card flex items-center justify-center p-6">
              <div className="skeleton size-32 rounded-full" />
            </div>
          ))}
        </div>
        <ChartSkeleton height={260} />
        <p className="text-center text-xs text-muted">{t('detail.loading')}</p>
      </div>
    );
  }

  if (nodeQuery.isError) {
    const notFound = nodeQuery.error instanceof ApiError && nodeQuery.error.isNotFound;
    return (
      <EmptyState
        tone={notFound ? 'default' : 'danger'}
        title={notFound ? t('detail.notFound') : t('error.title')}
        hint={notFound ? t('detail.notFoundHint') : errorMessage(nodeQuery.error)}
        action={
          <div className="flex gap-2">
            <Link to="/">
              <Button variant="secondary">{t('detail.back')}</Button>
            </Link>
            {notFound ? null : (
              <Button variant="primary" onClick={() => void nodeQuery.refetch()}>
                {t('common.retry')}
              </Button>
            )}
          </div>
        }
      />
    );
  }

  if (node === undefined) {
    return <EmptyState title={t('detail.notFound')} hint={t('detail.notFoundHint')} />;
  }

  const online = node.online;
  const metrics = node.metrics;
  const hasMetrics = metrics !== null;

  const cpu = hasMetrics ? metrics.cpu : 0;
  const memPercent = hasMetrics ? ratioPercent(metrics.mem_used, metrics.mem_total) : 0;
  const diskPercent = hasMetrics ? ratioPercent(metrics.disk_used, metrics.disk_total) : 0;
  const swapPercent = hasMetrics ? ratioPercent(metrics.swap_used, metrics.swap_total) : 0;
  const uptimeSeconds = metrics?.uptime ?? node.uptime;

  const statusLabel = online ? t('status.online') : t('status.offline');
  // `step` is 1 for raw rows; showing "1s" is noise, so render a dash instead.
  const stepLabel = series === undefined || series.step <= 1 ? '–' : duration(series.step, 2, lang);

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
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
              <StatusDot online={online} label={statusLabel} />
              <span className="truncate">{node.name}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={online ? 'success' : 'muted'} dot>
                {statusLabel}
              </Badge>
              <Badge tone="accent">{node.group}</Badge>
              {node.region.length > 0 ? <Badge tone="muted">{node.region}</Badge> : null}
              {node.tags.map((tag) => (
                <Badge key={tag} tone="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 text-right text-[11px] text-muted">
            {node.ip.length > 0 ? (
              <span className="num">
                {t('node.ip')}: {node.ip}
              </span>
            ) : null}
            <span>
              {t('node.lastSeen')}: {relativeTime(node.last_seen, now, lang)}
            </span>
            <span className="num">{dateTime(node.last_seen)}</span>
            <span className="num">
              {t('node.created')}: {dateTime(node.created_at)}
            </span>
          </div>
        </div>
      </header>

      {!hasMetrics ? <Notice tone="warn">{t('node.noMetrics')}</Notice> : null}

      {/* gauges */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card flex items-center justify-center p-5">
          <Gauge
            value={cpu}
            label={t('node.cpu')}
            sublabel={hasMetrics ? `${number(cpu, 1)}%` : undefined}
          />
        </div>
        <div className="card flex items-center justify-center p-5">
          <Gauge
            value={memPercent}
            label={t('node.mem')}
            sublabel={
              hasMetrics && metrics.mem_total > 0
                ? `${bytes(metrics.mem_used)} / ${bytes(metrics.mem_total)}`
                : undefined
            }
          />
        </div>
        <div className="card flex items-center justify-center p-5">
          <Gauge
            value={diskPercent}
            label={t('node.disk')}
            sublabel={
              hasMetrics && metrics.disk_total > 0
                ? `${bytes(metrics.disk_used)} / ${bytes(metrics.disk_total)}`
                : undefined
            }
          />
        </div>
      </section>

      {/* tiles */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label={t('node.load1')}
          icon={<IconActivity />}
          value={hasMetrics ? number(metrics.load1, 2) : '–'}
          hint={
            hasMetrics
              ? `${t('node.load5')} ${number(metrics.load5, 2)} · ${t('node.load15')} ${number(metrics.load15, 2)}`
              : undefined
          }
        />
        <StatCard
          label={t('node.uptime')}
          icon={<IconClock />}
          value={online ? duration(uptimeSeconds, 2, lang) : '–'}
          hint={durationLong(uptimeSeconds, lang)}
        />
        <StatCard
          label={t('node.rxRate')}
          icon={<IconDownload />}
          value={hasMetrics ? rate(metrics.rx_rate) : '–'}
          tone="success"
        />
        <StatCard
          label={t('node.txRate')}
          icon={<IconUpload />}
          value={hasMetrics ? rate(metrics.tx_rate) : '–'}
          tone="accent"
        />
        <StatCard
          label={t('node.trafficIn')}
          icon={<IconDatabase />}
          value={hasMetrics ? bytes(metrics.net_in) : '–'}
          hint={hasMetrics ? `${int(metrics.net_in)} B` : undefined}
        />
        <StatCard
          label={t('node.trafficOut')}
          icon={<IconDatabase />}
          value={hasMetrics ? bytes(metrics.net_out) : '–'}
          hint={hasMetrics ? `${int(metrics.net_out)} B` : undefined}
        />
        <StatCard
          label={t('node.swap')}
          icon={<IconMemory />}
          value={hasMetrics && metrics.swap_total > 0 ? percent(swapPercent) : '–'}
          hint={
            hasMetrics && metrics.swap_total > 0
              ? `${bytes(metrics.swap_used)} / ${bytes(metrics.swap_total)}`
              : undefined
          }
        />
        <StatCard
          label={t('node.process')}
          icon={<IconCpu />}
          value={hasMetrics ? int(metrics.process) : '–'}
          hint={
            hasMetrics ? `TCP ${int(metrics.tcp)} · UDP ${int(metrics.udp)}` : undefined
          }
        />
      </section>

      {/* history */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text">{t('detail.history')}</h2>
            {metricsQuery.isFetching ? <Spinner size={12} className="text-muted" /> : null}
          </div>
          <div className="flex items-center gap-3">
            {series !== undefined ? (
              <span className="hidden text-[11px] text-muted sm:inline">
                {t('detail.step')} {stepLabel} · {t('detail.points')} {int(points.length)}
              </span>
            ) : null}
            <RangeSwitch value={hours} onChange={setHours} />
          </div>
        </div>

        {metricsQuery.isError ? (
          <EmptyState
            tone="danger"
            title={t('error.title')}
            hint={errorMessage(metricsQuery.error)}
            action={
              <Button variant="secondary" onClick={() => void metricsQuery.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : metricsQuery.isPending ? (
          <div className="flex flex-col gap-4">
            <ChartSkeleton height={260} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartSkeleton height={220} />
              <ChartSkeleton height={220} />
            </div>
          </div>
        ) : points.length === 0 ? (
          <EmptyState title={t('detail.noHistory')} hint={t('detail.noHistoryHint')} />
        ) : (
          <div className="flex flex-col gap-4">
            <ChartCard
              title={t('chart.cpuMem')}
              legend={
                <>
                  <LegendDot color={cssVar('--accent', '#0092ff')} label="CPU" />
                  <LegendDot color={cssVar('--success', '#1cf8ba')} label="MEM" />
                </>
              }
            >
              <Chart option={options.cpuMem} height={260} ariaLabel={t('chart.cpuMem')} />
            </ChartCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ChartCard
                title={t('chart.netRate')}
                legend={
                  <>
                    <LegendDot color={cssVar('--success', '#1cf8ba')} label="↓ RX" />
                    <LegendDot color={cssVar('--accent', '#0092ff')} label="↑ TX" />
                  </>
                }
              >
                <Chart option={options.net} height={220} ariaLabel={t('chart.netRate')} />
              </ChartCard>

              <ChartCard
                title={t('chart.load')}
                legend={<LegendDot color={cssVar('--danger', '#f0506e')} label={t('node.load1')} />}
              >
                <Chart option={options.load} height={220} ariaLabel={t('chart.load')} />
              </ChartCard>

              <ChartCard
                title={t('chart.traffic')}
                legend={
                  <>
                    <LegendDot color={cssVar('--success', '#1cf8ba')} label={t('node.trafficIn')} />
                    <LegendDot color={cssVar('--accent', '#0092ff')} label={t('node.trafficOut')} />
                  </>
                }
              >
                <Chart option={options.traffic} height={220} ariaLabel={t('chart.traffic')} />
              </ChartCard>

              <ChartCard
                title={t('chart.disk')}
                legend={<LegendDot color={cssVar('--warn', '#f5a524')} label={t('node.disk')} />}
              >
                <Chart option={options.disk} height={220} ariaLabel={t('chart.disk')} />
              </ChartCard>
            </div>
          </div>
        )}
      </section>

      <PingTable node={node} />

      <p className="text-center text-[11px] text-muted">
        {t('detail.autoRefresh', { seconds: 10 })}
      </p>
    </div>
  );
}
