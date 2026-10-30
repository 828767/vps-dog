import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { StatCard, StatCardSkeleton } from '../../components/StatCard';
import {
  IconActivity,
  IconAlertTriangle,
  IconCalendar,
  IconChart,
  IconDatabase,
  IconServer,
} from '../../components/icons';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { bytes, dateTime, int, percent } from '../../lib/format';
import { useI18n } from '../../lib/i18n';

/** `/admin/overview` — database + fleet summary from `GET /api/admin/overview`. */
export default function AdminOverview(): ReactNode {
  const { t } = useI18n();
  const overviewQuery = useQuery({
    queryKey: qk.adminOverview,
    queryFn: ({ signal }) => adminApi.overview(signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const data = overviewQuery.data;
  const healthPercent =
    data !== undefined && data.nodes > 0 ? (data.online / data.nodes) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.dashboard')} subtitle={t('app.tagline')} />

      {overviewQuery.isError ? (
        <ErrorBanner
          message={errorMessage(overviewQuery.error)}
          onRetry={() => void overviewQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      {overviewQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <StatCardSkeleton key={index} />
          ))}
        </div>
      ) : data === undefined ? null : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard
            label={t('admin.overview.nodes')}
            value={int(data.nodes)}
            icon={<IconServer />}
            tone="accent"
          />
          <StatCard
            label={t('admin.overview.online')}
            value={int(data.online)}
            icon={<IconActivity />}
            tone="success"
            hint={percent(healthPercent, 1)}
          />
          <StatCard
            label={t('admin.overview.offline')}
            value={int(data.offline)}
            icon={<IconAlertTriangle />}
            tone={data.offline > 0 ? 'danger' : 'muted'}
          />
          <StatCard
            label={t('admin.overview.rows')}
            value={int(data.metrics_rows)}
            icon={<IconChart />}
          />
          <StatCard
            icon={<IconCalendar />}
            label={t('admin.overview.oldest')}
            value={data.oldest_ts > 0 ? dateTime(data.oldest_ts).slice(0, 10) : '–'}
            hint={data.oldest_ts > 0 ? dateTime(data.oldest_ts) : undefined}
          />
          <StatCard
            label={t('admin.overview.d1')}
            value={bytes(data.d1_size)}
            icon={<IconDatabase />}
          />
        </div>
      )}
    </div>
  );
}
