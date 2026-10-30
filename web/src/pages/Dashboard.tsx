import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import {
  LayoutModeSwitch,
  MeterStyleSwitch,
  readLayoutMode,
  readMeterStyle,
  writeLayoutMode,
  writeMeterStyle,
  type LayoutMode,
  type MeterStyle,
} from '../components/ViewModeSwitches';
import { Select } from '../components/Select';
import { NodeCard, NodeCardSkeleton } from '../components/NodeCard';
import { UptimePanel } from '../components/UptimePanel';
import { Spinner } from '../components/Spinner';
import { StatCard, StatCardSkeleton } from '../components/StatCard';
import {
  IconActivity,
  IconAlertTriangle,
  IconRefresh,
  IconServer,
  IconServerStack,
} from '../components/icons';
import { errorMessage } from '../lib/api';
import { int, number, relativeTime } from '../lib/format';
import { useI18n } from '../lib/i18n';
import { useDebounced, useGroups, useNodesLive, useNow } from '../lib/useLive';
import type { NodeSummary } from '../lib/types';

/** The four fleet KPIs above the node list. */
function FleetStrip(): ReactNode {
  const { t } = useI18n();
  const { data, isPending } = useNodesLive();

  if (isPending || data === undefined) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  const { status } = data;
  const healthy = status.total > 0 && status.offline === 0;
  const successRate = status.total === 0 ? 0 : (status.online / status.total) * 100;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('status.online')}
          value={int(status.online)}
          unit={`/ ${int(status.total)}`}
          icon={<IconServerStack />}
          tone="success"
          trailing={
            <Badge tone={healthy ? 'success' : 'warn'}>
              {healthy ? t('dashboard.allHealthy') : t('status.degraded')}
            </Badge>
          }
        />
        <StatCard
          label={t('status.offline')}
          value={int(status.offline)}
          unit={`/ ${int(status.total)}`}
          icon={<IconAlertTriangle />}
          iconTone={status.offline > 0 ? 'danger' : 'accent'}
          trailing={
            <Badge tone={status.offline > 0 ? 'danger' : 'muted'}>
              {status.offline > 0 ? t('status.degraded') : t('dashboard.noIssues')}
            </Badge>
          }
        />
        <StatCard
          label={t('status.total')}
          value={int(status.total)}
          unit={t('dashboard.serversUnit')}
          icon={<IconServer />}
          iconTone="accent"
          trailing={<span className="text-[11px] text-muted">{t('dashboard.totalServers')}</span>}
        />
        <StatCard
          label={t('dashboard.healthRate')}
          value={`${number(successRate, 0)}%`}
          icon={<IconActivity />}
          iconTone={status.total === 0 ? 'muted' : 'success'}
          tone={status.total === 0 ? 'muted' : healthy ? 'success' : 'warn'}
          trailing={<span className="text-[11px] text-muted">{t('dashboard.last24h')}</span>}
        />
      </div>
  );
}

export default function Dashboard(): ReactNode {
  const { t, lang } = useI18n();
  const { data, isPending, isError, error, refetch, isFetching } = useNodesLive();
  const groupsQuery = useGroups();
  const now = useNow(5_000);

  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const [showHidden, setShowHidden] = useState(false);
  const [meterStyle, setMeterStyle] = useState<MeterStyle>(readMeterStyle);
  const [layout, setLayout] = useState<LayoutMode>(readLayoutMode);
  const debouncedSearch = useDebounced(search, 180);

  useEffect(() => {
    writeMeterStyle(meterStyle);
  }, [meterStyle]);

  useEffect(() => {
    writeLayoutMode(layout);
  }, [layout]);

  const nodes = useMemo<ReadonlyArray<NodeSummary>>(() => data?.nodes ?? [], [data]);

  const groupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of nodes) {
      if (node.hidden && !showHidden) continue;
      counts.set(node.group, (counts.get(node.group) ?? 0) + 1);
    }
    // Prefer the worker's aggregate when it is available.
    for (const entry of groupsQuery.data?.groups ?? []) {
      if (!counts.has(entry.name)) counts.set(entry.name, entry.count);
    }
    return [
      { value: 'all', label: t('dashboard.allGroups') },
      ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ value: name, label: `${name} (${count})` })),
    ];
  }, [nodes, groupsQuery.data, showHidden, t]);

  const filtered = useMemo(() => {
    const needle = debouncedSearch.trim().toLowerCase();
    return nodes.filter((node) => {
      if (node.hidden && !showHidden) return false;
      if (group !== 'all' && node.group !== group) return false;
      if (needle.length === 0) return true;
      const haystack = [node.name, node.group, node.region, node.ip, ...node.tags]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [nodes, debouncedSearch, group, showHidden]);

  const filtersActive = debouncedSearch.trim().length > 0 || group !== 'all' || showHidden;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-text">
              <span className="h-5 w-[3px] shrink-0 rounded-full bg-success" aria-hidden="true" />
              {t('dashboard.title')}
            </h1>
            <p className="text-xs text-muted">{t('dashboard.subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LayoutModeSwitch value={layout} onChange={setLayout} />
            <MeterStyleSwitch value={meterStyle} onChange={setMeterStyle} />
            <Button
              size="pill"
              variant="pill"
              onClick={() => void refetch()}
              loading={isFetching && !isPending}
              icon={<IconRefresh className="size-3.5" />}
            >
              {t('common.refresh')}
            </Button>
            {data !== undefined ? (
              <span className="hidden text-[11px] text-muted sm:inline">
                {t('dashboard.updatedAt', { time: relativeTime(data.status.generated_at, now, lang) })}
              </span>
            ) : null}
          </div>
        </div>

        <FleetStrip />

        <UptimePanel layout={layout} />

        {/* filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label={t('dashboard.search')}
              placeholder={t('dashboard.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={t('dashboard.searchLabel')}
              type="search"
            />
          </div>
          <div className="sm:w-56">
            <Select
              label={t('dashboard.groupLabel')}
              value={group}
              onChange={(event) => setGroup(event.target.value)}
              options={groupOptions}
            />
          </div>
          <label className="flex h-9.5 cursor-pointer items-center gap-2 text-xs font-medium text-muted select-none">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => setShowHidden(event.target.checked)}
              className="size-4 cursor-pointer rounded border-border bg-surface-2 accent-[var(--accent)]"
            />
            {t('dashboard.showHidden')}
          </label>
        </div>
      </header>

      {isError ? (
        <EmptyState
          tone="danger"
          title={t('error.title')}
          hint={errorMessage(error)}
          action={
            <Button variant="secondary" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : isPending ? (
        <div className="flex flex-col gap-4">
          {[0, 1].map((index) => (
            <NodeCardSkeleton key={index} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title={t('dashboard.noMatch')}
            hint={t('dashboard.noMatchHint')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setGroup('all');
                  setShowHidden(false);
                }}
              >
                {t('dashboard.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t('dashboard.empty')} hint={t('dashboard.emptyHint')} />
        )
      ) : (
        <div
          className={
            layout === 'compact'
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
              : 'flex flex-col gap-4'
          }
        >
          {filtered.map((node) => (
            <NodeCard key={node.id} node={node} layout={layout} meterStyle={meterStyle} />
          ))}
        </div>
      )}

      {/* Fixed-height slot: the indicator must not shift the page in and out
          of the layout on every poll cycle. */}
      <div className="flex h-4 items-center justify-center" aria-live="polite">
        {isFetching && !isPending && !isError ? (
          <p className="flex items-center gap-2 text-[11px] text-muted">
            <Spinner size={11} />
            {t('common.loading')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
