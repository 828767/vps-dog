import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { Table, type Column } from '../../components/Table';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { dateTime, relativeTime, truncate } from '../../lib/format';
import { useI18n } from '../../lib/i18n';
import { useNow } from '../../lib/useLive';
import type { AuditRow } from '../../lib/types';

const LIMITS = [50, 100, 200, 500] as const;

/** Tone for an action verb, so the log reads at a glance. */
function actionTone(action: string): 'success' | 'danger' | 'accent' | 'warn' | 'muted' {
  const verb = action.toLowerCase();
  if (verb.includes('create') || verb.includes('login') || verb.includes('rotate')) return 'success';
  if (verb.includes('delete') || verb.includes('fail') || verb.includes('logout')) return 'danger';
  if (verb.includes('update') || verb.includes('patch') || verb.includes('set')) return 'accent';
  if (verb.includes('hide') || verb.includes('disable')) return 'warn';
  return 'muted';
}

/** `/admin/audit` — recent audit rows from `GET /api/admin/audit?limit=`. */
export default function AdminAudit(): ReactNode {
  const { t, lang } = useI18n();
  const now = useNow(10_000);
  const [limit, setLimit] = useState<number>(100);

  const auditQuery = useQuery({
    queryKey: qk.adminAudit(limit),
    queryFn: ({ signal }) => adminApi.audit(limit, signal),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const rows = auditQuery.data?.audit ?? [];

  const columns = useMemo<ReadonlyArray<Column<AuditRow>>>(
    () => [
      {
        key: 'ts',
        header: t('common.time'),
        render: (row) => (
          <div className="flex flex-col gap-0.5">
            <span className="num whitespace-nowrap text-text">{dateTime(row.ts)}</span>
            <span className="text-[11px] text-muted">{relativeTime(row.ts, now, lang)}</span>
          </div>
        ),
      },
      {
        key: 'user',
        header: t('common.user'),
        render: (row) => <span className="text-text">{row.user.length > 0 ? row.user : '–'}</span>,
      },
      {
        key: 'action',
        header: t('common.action'),
        render: (row) => <Badge tone={actionTone(row.action)}>{row.action}</Badge>,
      },
      {
        key: 'target',
        header: t('common.target'),
        render: (row) =>
          row.target.length > 0 ? (
            <span className="font-mono text-[11px] text-muted" title={row.target}>
              {truncate(row.target, 28)}
            </span>
          ) : (
            <span className="text-muted">–</span>
          ),
      },
      {
        key: 'detail',
        header: t('common.detail'),
        hideOnMobile: true,
        render: (row) => (
          <span className="block max-w-[22rem] truncate text-[11px] text-muted" title={row.detail}>
            {row.detail.length > 0 ? row.detail : '–'}
          </span>
        ),
      },
      {
        key: 'ip',
        header: t('common.ip'),
        align: 'right',
        hideOnMobile: true,
        render: (row) => <span className="num text-[11px] text-muted">{row.ip.length > 0 ? row.ip : '–'}</span>,
      },
    ],
    [t, lang, now],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.audit.title')}
        subtitle={t('admin.audit.subtitle')}
        actions={
          <div className="w-48">
            <Select
              aria-label={t('admin.audit.limit', { count: limit })}
              value={String(limit)}
              onChange={(event) => setLimit(Number.parseInt(event.target.value, 10))}
              options={LIMITS.map((value) => ({
                value: String(value),
                label: t('admin.audit.limit', { count: value }),
              }))}
            />
          </div>
        }
      />

      {auditQuery.isError ? (
        <ErrorBanner
          message={errorMessage(auditQuery.error)}
          onRetry={() => void auditQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      <section className="card p-5">
        <Table
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={auditQuery.isPending}
          loadingLabel={t('common.loading')}
          empty={<EmptyState compact title={t('admin.audit.empty')} hint={t('admin.audit.emptyHint')} />}
          caption={rows.length > 0 ? <span className="num">{rows.length}</span> : undefined}
        />
      </section>
    </div>
  );
}
