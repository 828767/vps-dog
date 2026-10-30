import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { AppFooter } from '../../components/AppFooter';
import { Badge } from '../../components/Badge';
import { Brand } from '../../components/Brand';
import { Button, IconButton } from '../../components/Button';
import { LangToggle, ThemeToggle } from '../../components/HeaderPills';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { authApi, errorMessage, qk } from '../../lib/api';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { useStatusLive } from '../../lib/useLive';
import type { User } from '../../lib/types';
import { ChangePasswordDialog } from './AdminDialogs';

interface AdminAuthValue {
  user: User;
  logout: () => void;
  loggingOut: boolean;
  /**
   * True when the signed-in account may mutate state.
   *
   * The Worker is the real enforcement point (`403` for a viewer on any
   * mutating request) — this flag only hides controls the request would reject,
   * so a viewer never sees a button that cannot work.
   */
  canEdit: boolean;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

/** Current admin user; only valid inside `<AdminLayout>`. */
export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (ctx === null) throw new Error('useAdminAuth must be used inside <AdminLayout>');
  return ctx;
}

interface NavItem {
  to: string;
  label: TranslationKey;
  icon: ReactNode;
}

function icon(path: string): ReactNode {
  return (
    <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { to: '/admin/overview', label: 'admin.dashboard', icon: icon('M3 10.5 10 4l7 6.5V16a1 1 0 0 1-1 1h-3v-4H7v4H4a1 1 0 0 1-1-1v-5.5Z') },
  { to: '/admin/nodes', label: 'admin.nodes', icon: icon('M3 5.5h14v3.5H3zM3 11h14v3.5H3zM6 7.2h.01M6 12.7h.01') },
  { to: '/admin/pings', label: 'admin.pings', icon: icon('M2.5 10h3l2-4.5 3 9 2-4.5h5') },
  { to: '/admin/uptime', label: 'admin.uptime', icon: icon('M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3.5V10l2.5 1.5') },
  { to: '/admin/settings', label: 'admin.settings', icon: icon('M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Zm6.4-2.6c0 .5-.05 1-.15 1.4l1.4 1.05-1.5 2.6-1.65-.65c-.7.55-1.5.95-2.35 1.2L11.9 17h-3l-.25-1.4a7 7 0 0 1-2.35-1.2l-1.65.65-1.5-2.6L4.55 11.4a7 7 0 0 1 0-2.8L3.15 7.55l1.5-2.6 1.65.65c.7-.55 1.5-.95 2.35-1.2L8.9 3h3l.25 1.4c.85.25 1.65.65 2.35 1.2l1.65-.65 1.5 2.6-1.4 1.05c.1.4.15.9.15 1.4Z') },
  { to: '/admin/users', label: 'admin.users', icon: icon('M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 6c0-2.5 2.7-4.2 6-4.2s6 1.7 6 4.2') },
  { to: '/admin/audit', label: 'admin.audit', icon: icon('M5 3.5h7l3 3V16a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 5 16V4a.5.5 0 0 1 .5-.5ZM7.5 8h5M7.5 11h5M7.5 14h3') },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }): ReactNode {
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-1" aria-label={t('admin.title')}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? 'bg-accent/12 text-accent'
                : 'text-muted hover:bg-surface-2 hover:text-text'
            }`
          }
        >
          {item.icon}
          <span className="truncate">{t(item.label)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

const MENU_ICON = (open: boolean): ReactNode => (
  <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
    <path
      d={open ? 'M5 5l10 10M15 5 5 15' : 'M3 6h14M3 10h14M3 14h14'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/** Admin shell: auth guard + sidebar + content column. */
export default function AdminLayout(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const { data: status } = useStatusLive();
  const siteName = status?.site_name !== undefined && status.site_name.length > 0 ? status.site_name : t('app.name');

  const meQuery = useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => authApi.me(signal),
    retry: false,
    staleTime: 60_000,
  });

  const logout = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      queryClient.setQueryData(qk.me, undefined);
      queryClient.clear();
      void navigate('/admin', { replace: true });
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const authValue = useMemo<AdminAuthValue | null>(() => {
    if (meQuery.data === undefined) return null;
    return {
      user: meQuery.data.user,
      logout: () => logout.mutate(),
      loggingOut: logout.isPending,
      canEdit: meQuery.data.user.role === 'admin',
    };
  }, [meQuery.data, logout]);

  if (meQuery.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center gap-3 bg-bg text-muted">
        <Spinner size={20} />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  // 401 (or any failure to establish identity) bounces to the login screen.
  if (meQuery.isError || authValue === null) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <AdminAuthContext.Provider value={authValue}>
      <div className="flex min-h-dvh flex-col bg-bg lg:flex-row">
        {/* desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-border bg-surface px-3 py-5 lg:flex">
          <div className="flex flex-col gap-5">
            <div className="px-2">
              <Brand name={siteName} to="/" size="sm" />
            </div>
            <SidebarNav />
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex min-w-0 flex-col gap-1 px-2">
              <span className="truncate text-[11px] text-muted">
                {t('admin.signedInAs', { name: authValue.user.username })}
              </span>
              {/* The role was a bare `admin`/`viewer` token sitting directly
                  under the username, which read as the name printed twice. */}
              {/* `items-start` stops the column from stretching the badge to
                  full width (it is inline-flex, so it would fill the row). */}
              <span className="flex items-start">
                <Badge tone={authValue.user.role === 'admin' ? 'accent' : 'muted'}>
                  {t(authValue.user.role === 'admin' ? 'admin.users.role.admin' : 'admin.users.role.viewer')}
                </Badge>
              </span>
            </div>
            {/* Same total width as the full-width buttons below, so the
                sidebar's controls share one left/right edge. */}
            <div className="flex items-stretch gap-2">
              <span className="flex min-w-0 flex-1 [&>button]:w-full">
                <ThemeToggle onSurface />
              </span>
              <LangToggle onSurface />
            </div>
            <div className="flex flex-col gap-1.5">
              <Button
                size="pill"
                variant="pill-surface"
                block
                onClick={() => void navigate('/')}
              >
                {t('admin.backToSite')}
              </Button>
              <Button
                size="pill"
                variant="pill-surface"
                block
                onClick={() => setPwOpen(true)}
              >
                {t('admin.password.change')}
              </Button>
              <Button
                size="pill"
                variant="pill-surface"
                block
                onClick={() => logout.mutate()}
                loading={logout.isPending}
              >
                {t('nav.logout')}
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* mobile top bar — same chrome as the public header */}
          <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur-md lg:hidden">
            <Brand name={siteName} to="/admin/overview" />
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              <LangToggle />
              <IconButton
                label={menuOpen ? t('nav.close') : t('nav.menu')}
                onClick={() => setMenuOpen((open) => !open)}
              >
                {MENU_ICON(menuOpen)}
              </IconButton>
            </div>
          </header>

          {menuOpen ? (
            <div className="border-b border-border bg-surface px-4 py-3 lg:hidden">
              <SidebarNav onNavigate={() => setMenuOpen(false)} />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
                <Link to="/" className="text-xs text-muted transition-colors duration-150 hover:text-text">
                  {t('admin.backToSite')}
                </Link>
                <div className="flex items-center gap-2">
                  <Button size="pill" variant="pill-surface" onClick={() => setPwOpen(true)}>
                    {t('admin.password.change')}
                  </Button>
                  <Button
                    size="pill"
                    variant="pill-surface"
                    onClick={() => logout.mutate()}
                    loading={logout.isPending}
                  >
                    {t('nav.logout')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <Outlet />
          </main>

          <AppFooter siteName={siteName} tagline={t('admin.title')} />
        </div>
      </div>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </AdminAuthContext.Provider>
  );
}
