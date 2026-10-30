import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Checkbox, Input, Textarea } from '../../components/Input';
import { FormError } from '../../components/Notice';
import { ErrorBanner, PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { useToast } from '../../components/Toast';
import { adminApi, errorMessage, qk } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import type { Settings, ThemeSetting } from '../../lib/types';
import { useAdminAuth } from './AdminLayout';

interface SettingsForm {
  site_name: string;
  site_description: string;
  report_interval: string;
  offline_after: string;
  retention_days: string;
  ping_retention_days: string;
  theme: ThemeSetting;
  custom_head: string;
  tg_bot_token: string;
  tg_chat_id: string;
  tg_notify_offline: boolean;
  tg_notify_online: boolean;
  tg_notify_uptime: boolean;
}

function toForm(settings: Settings): SettingsForm {
  return {
    site_name: settings.site_name ?? '',
    site_description: settings.site_description ?? '',
    report_interval: String(settings.report_interval),
    offline_after: String(settings.offline_after),
    retention_days: String(settings.retention_days),
    ping_retention_days: String(settings.ping_retention_days),
    theme: settings.theme,
    custom_head: settings.custom_head ?? '',
    tg_bot_token: settings.tg_bot_token ?? '',
    tg_chat_id: settings.tg_chat_id ?? '',
    tg_notify_offline: settings.tg_notify_offline ?? true,
    tg_notify_online: settings.tg_notify_online ?? false,
    tg_notify_uptime: settings.tg_notify_uptime ?? true,
  };
}

/** `/admin/settings` — site identity, cadence and retention. */
export default function AdminSettings(): ReactNode {
  const { t } = useI18n();
  const { canEdit } = useAdminAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<SettingsForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: qk.adminSettings,
    queryFn: ({ signal }) => adminApi.getSettings(signal),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (settingsQuery.data !== undefined) setForm(toForm(settingsQuery.data));
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: SettingsForm) =>
      adminApi.updateSettings({
        site_name: input.site_name.trim().length > 0 ? input.site_name.trim() : 'VPS-DOG',
        site_description: input.site_description,
        report_interval: Number.parseInt(input.report_interval, 10) || 30,
        offline_after: Number.parseInt(input.offline_after, 10) || 90,
        retention_days: Number.parseInt(input.retention_days, 10) || 30,
        ping_retention_days: Number.parseInt(input.ping_retention_days, 10) || 7,
        theme: input.theme,
        custom_head: input.custom_head,
        tg_bot_token: input.tg_bot_token.trim(),
        tg_chat_id: input.tg_chat_id.trim(),
        tg_notify_offline: input.tg_notify_offline,
        tg_notify_online: input.tg_notify_online,
        tg_notify_uptime: input.tg_notify_uptime,
      }),
    onSuccess: () => {
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: qk.adminSettings });
      void queryClient.invalidateQueries({ queryKey: qk.status });
      void queryClient.invalidateQueries({ queryKey: qk.nodes });
      toast.success(t('admin.settings.saved'));
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const telegramTestMutation = useMutation({
    mutationFn: () => adminApi.sendTelegramTest(),
    onSuccess: () => toast.success(t('admin.settings.tgTestOk')),
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form === null) return;
    saveMutation.mutate(form);
  };

  const themeOptions = [
    { value: 'auto', label: t('theme.auto') },
    { value: 'light', label: t('theme.light') },
    { value: 'dark', label: t('theme.dark') },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.settings.title')} subtitle={t('admin.settings.subtitle')} />

      {settingsQuery.isError ? (
        <ErrorBanner
          message={errorMessage(settingsQuery.error)}
          onRetry={() => void settingsQuery.refetch()}
          retryLabel={t('common.retry')}
        />
      ) : null}

      {settingsQuery.isPending || form === null ? (
        <div className="card flex flex-col gap-4 p-5">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="flex flex-col gap-1.5">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-9 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text">{t('admin.settings.group.identity')}</h2>
            <Input
              label={t('admin.settings.siteName')}
              value={form.site_name}
              onChange={(event) => setForm({ ...form, site_name: event.target.value })}
              required
            />
            <Input
              label={t('admin.settings.siteDescription')}
              value={form.site_description}
              onChange={(event) => setForm({ ...form, site_description: event.target.value })}
            />
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text">{t('admin.settings.group.reporting')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('admin.settings.reportInterval')}
                type="number"
                min={10}
                max={3600}
                value={form.report_interval}
                onChange={(event) => setForm({ ...form, report_interval: event.target.value })}
              />
              <Input
                label={t('admin.settings.offlineAfter')}
                type="number"
                min={10}
                value={form.offline_after}
                onChange={(event) => setForm({ ...form, offline_after: event.target.value })}
              />
              <Input
                label={t('admin.settings.retentionDays')}
                type="number"
                min={1}
                value={form.retention_days}
                onChange={(event) => setForm({ ...form, retention_days: event.target.value })}
              />
              <Input
                label={t('admin.settings.pingRetentionDays')}
                type="number"
                min={1}
                value={form.ping_retention_days}
                onChange={(event) => setForm({ ...form, ping_retention_days: event.target.value })}
              />
            </div>
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text">{t('admin.settings.group.appearance')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label={t('admin.settings.theme')}
                value={form.theme}
                onChange={(event) => setForm({ ...form, theme: event.target.value as ThemeSetting })}
                options={themeOptions}
              />
            </div>
            <Textarea
              label={t('admin.settings.customHead')}
              hint={t('admin.settings.customHeadHint')}
              value={form.custom_head}
              onChange={(event) => setForm({ ...form, custom_head: event.target.value })}
              rows={5}
              spellCheck={false}
            />
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="text-sm font-semibold text-text">{t('admin.settings.group.notifications')}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('admin.settings.tgToken')}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={form.tg_bot_token}
                hint={t('admin.settings.tgTokenHint')}
                onChange={(event) => setForm({ ...form, tg_bot_token: event.target.value })}
              />
              <Input
                label={t('admin.settings.tgChatId')}
                value={form.tg_chat_id}
                hint={t('admin.settings.tgChatIdHint')}
                onChange={(event) => setForm({ ...form, tg_chat_id: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Checkbox
                label={t('admin.settings.tgOffline')}
                checked={form.tg_notify_offline}
                onChange={(event) => setForm({ ...form, tg_notify_offline: event.target.checked })}
              />
              <Checkbox
                label={t('admin.settings.tgOnline')}
                checked={form.tg_notify_online}
                onChange={(event) => setForm({ ...form, tg_notify_online: event.target.checked })}
              />
              <Checkbox
                label={t('admin.settings.tgUptime')}
                checked={form.tg_notify_uptime}
                onChange={(event) => setForm({ ...form, tg_notify_uptime: event.target.checked })}
              />
            </div>
            <p className="text-xs text-muted/80">{t('admin.settings.tgHint')}</p>
            <div>
              <Button
                variant="ghost"
                disabled={form.tg_bot_token.trim() === '' || form.tg_chat_id.trim() === '' || telegramTestMutation.isPending}
                loading={telegramTestMutation.isPending}
                onClick={() => telegramTestMutation.mutate()}
              >
                {t('admin.settings.tgTest')}
              </Button>
            </div>
          </section>

          {formError !== null ? <FormError message={formError} /> : null}

          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button type="submit" variant="primary" loading={saveMutation.isPending}>
                {saveMutation.isPending ? t('common.saving') : t('common.save')}
              </Button>
            ) : (
              <Badge tone="muted">{t('admin.readOnly')}</Badge>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                if (settingsQuery.data !== undefined) {
                  setForm(toForm(settingsQuery.data));
                  setFormError(null);
                }
              }}
              disabled={saveMutation.isPending}
            >
              {t('common.reset')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
