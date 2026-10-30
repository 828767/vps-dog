import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { StatusDot } from './Badge';
import { IconBell, IconGear, IconShield } from './icons';
import { useI18n } from '../lib/i18n';
import { useTheme, type ThemeMode } from '../lib/theme';
import { useNodesLive, useStatusLive } from '../lib/useLive';
import { PILL_ACTIVE, PILL_BASE, PILL_FILL, PILL_IDLE, type PillSurface } from './pill';

/* ── theme ────────────────────────────────────────────────────────────────── */

const THEME_ICON: Record<ThemeMode, ReactNode> = {
  auto: (
    <>
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M15.4 4.6l-1.3 1.3M5.9 14.1l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  light: (
    <>
      <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.4v1.8M10 15.8v1.8M2.4 10h1.8M15.8 10h1.8M4.6 4.6l1.3 1.3M14.1 14.1l1.3 1.3M15.4 4.6l-1.3 1.3M5.9 14.1l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  dark: (
    <path
      d="M16 11.6A6.4 6.4 0 0 1 8.4 4a6.8 6.8 0 1 0 7.6 7.6Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
};

function fillFor(onSurface: boolean): string {
  const surface: PillSurface = onSurface ? 'surface' : 'canvas';
  return PILL_FILL[surface];
}

/** Cycles auto → light → dark. Shows the current mode's name from `sm` up. */
export function ThemeToggle({ onSurface = false }: { onSurface?: boolean }): ReactNode {
  const { mode, cycle } = useTheme();
  const { t } = useI18n();
  const modeLabel = t(mode === 'auto' ? 'theme.auto' : mode === 'light' ? 'theme.light' : 'theme.dark');
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${t('nav.toggleTheme')} — ${modeLabel}`}
      title={`${t('nav.theme')}: ${modeLabel}`}
      className={`${PILL_BASE} ${PILL_IDLE} ${fillFor(onSurface)} gap-1.5 px-2.5`}
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
        {THEME_ICON[mode]}
      </svg>
      <span className="hidden text-xs font-medium sm:inline">{modeLabel}</span>
    </button>
  );
}

/** Chinese / English switch. */
export function LangToggle({ onSurface = false }: { onSurface?: boolean }): ReactNode {
  const { lang, toggleLang, t } = useI18n();
  const next = lang === 'zh-CN' ? 'English' : '简体中文';
  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label={`${t('nav.switchLanguage')} — ${next}`}
      title={t('nav.language')}
      className={`${PILL_BASE} ${PILL_IDLE} ${fillFor(onSurface)} min-w-8.5 justify-center px-2.5 text-xs font-semibold`}
    >
      {lang === 'zh-CN' ? '中' : 'EN'}
    </button>
  );
}

export interface PillLinkProps {
  to: string;
  icon: ReactNode;
  label: string;
  /** Hidden below `sm`, matching the header's other controls. */
  collapseLabel?: boolean;
}

/** Nav link rendered as a header pill, with the active state built in. */
export function PillLink({ to, icon, label, collapseLabel = true }: PillLinkProps): ReactNode {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `${PILL_BASE} ${isActive ? PILL_ACTIVE : `${PILL_IDLE} ${PILL_FILL.canvas}`} gap-1.5 px-2.5 text-xs font-medium`
      }
    >
      {icon}
      <span className={collapseLabel ? 'hidden sm:inline' : undefined}>{label}</span>
    </NavLink>
  );
}

/**
 * The header's notification pill: live alert state plus a popover listing the
 * nodes that are currently offline and the ones with alerts muted, with a
 * shortcut to the Telegram configuration.
 */
export function NotifyPill(): ReactNode {
  const { t } = useI18n();
  const { data } = useNodesLive();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nodes = data?.nodes ?? [];
  const offline = nodes.filter((node) => !node.online);
  const muted = nodes.filter((node) => node.notify === false);
  const alerting = offline.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('nav.notifications')}
        title={t('nav.notifications')}
        className={`${PILL_BASE} ${
          alerting ? 'border-danger/40 bg-danger/10 text-danger' : `${PILL_IDLE} ${PILL_FILL.canvas}`
        } relative gap-1.5 px-2.5 text-xs font-medium`}
      >
        <IconBell className="size-4" />
        <span className="hidden sm:inline">{t('nav.notifications')}</span>
        {alerting ? (
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-danger" aria-hidden="true" />
        ) : null}
      </button>

      {open ? (
        <div className="card absolute right-0 top-full z-50 mt-2 w-64 p-3 text-left shadow-lg">
          <p className="text-xs font-semibold text-text">{t('nav.notifications')}</p>
          <div className="mt-2 flex flex-col gap-1">
            <p className="text-[11px] font-medium text-muted">{t('notify.offlineSection')}</p>
            {offline.length === 0 ? (
              <p className="text-[11px] text-success">{t('notify.allOnline')}</p>
            ) : (
              offline.map((node) => (
                <span key={node.id} className="flex items-center gap-2 text-[11px] text-text">
                  <StatusDot online={false} label={node.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  {node.notify === false ? <IconBell className="size-3 text-muted opacity-50" /> : null}
                </span>
              ))
            )}
          </div>
          {muted.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
              <p className="text-[11px] font-medium text-muted">{t('notify.mutedSection')}</p>
              <p className="truncate text-[11px] text-muted">{muted.map((node) => node.name).join('、')}</p>
            </div>
          ) : null}
          <NavLink
            to="/admin/settings"
            onClick={() => setOpen(false)}
            className="mt-2 block border-t border-border pt-2 text-[11px] font-medium text-accent transition-colors duration-150 hover:text-text"
          >
            {t('notify.configure')} →
          </NavLink>
        </div>
      ) : null}
    </div>
  );
}

/** The header's nav cluster: system, alerts, admin. */
export function HeaderNav(): ReactNode {
  const { t } = useI18n();
  return (
    <>
      <PillLink to="/admin/settings" icon={<IconGear />} label={t('nav.system')} />
      <NotifyPill />
      <PillLink to="/admin" icon={<IconShield />} label={t('nav.admin')} />
    </>
  );
}

const STATUS_TONE_CLASS = {
  empty: 'border-border bg-surface text-muted',
  ok: 'border-success/35 bg-success/10 text-success',
  degraded: 'border-warn/35 bg-warn/10 text-warn',
  down: 'border-danger/35 bg-danger/10 text-danger',
} as const;

const STATUS_SHORT_KEY = {
  empty: 'status.short.empty',
  ok: 'status.short.ok',
  degraded: 'status.short.degraded',
  down: 'status.short.down',
} as const;

/**
 * Fleet health at a glance: a short verdict, a divider, then the counts.
 * Collapsed to a skeleton until the first poll lands so the header never
 * reflows.
 */
export function StatusPill(): ReactNode {
  const { t } = useI18n();
  const { data } = useStatusLive();

  if (data === undefined) {
    return (
      <span className="hidden h-8.5 items-center gap-2 rounded-xl border border-border bg-surface px-3 md:inline-flex">
        <span className="skeleton h-3 w-20" />
      </span>
    );
  }

  const empty = data.total === 0;
  const healthy = data.total > 0 && data.offline === 0;
  const tone: keyof typeof STATUS_TONE_CLASS = empty
    ? 'empty'
    : healthy
      ? 'ok'
      : data.offline === data.total
        ? 'down'
        : 'degraded';

  const short = t(STATUS_SHORT_KEY[tone]);
  const long = empty
    ? t('status.noNodes')
    : healthy
      ? t('status.allSystems')
      : t('status.degraded');

  return (
    <span
      className={`hidden h-8.5 items-center gap-2.5 rounded-xl border px-3 text-xs font-medium md:inline-flex ${STATUS_TONE_CLASS[tone]}`}
      title={`${short} · ${long}`}
    >
      <span className="flex items-center gap-1.5">
        <StatusDot online={tone === 'ok'} label={short} size="sm" />
        <span>{short}</span>
      </span>
      <span className="h-3.5 w-px bg-current opacity-30" aria-hidden="true" />
      <span className="num">
        {data.online}/{data.total}
      </span>
      <span className="hidden lg:inline">{long}</span>
    </span>
  );
}
