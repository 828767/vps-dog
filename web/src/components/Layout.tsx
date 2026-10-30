import { Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppFooter } from './AppFooter';
import { Brand } from './Brand';
import { HeaderNav, LangToggle, StatusPill, ThemeToggle } from './HeaderPills';
import { useI18n } from '../lib/i18n';
import { useStatusLive } from '../lib/useLive';

/** Public shell: sticky header + centred content column + footer. */
export function Layout(): ReactNode {
  const { t } = useI18n();
  const { data: status } = useStatusLive();

  const siteName = status?.site_name !== undefined && status.site_name.length > 0 ? status.site_name : t('app.name');
  const siteDescription =
    status?.site_description !== undefined && status.site_description.length > 0
      ? status.site_description
      : t('app.tagline');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Brand name={siteName} description={siteDescription} />

          <nav className="flex shrink-0 items-center gap-2" aria-label={t('nav.menu')}>
            <StatusPill />
            <ThemeToggle />
            <LangToggle />
            <HeaderNav />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <AppFooter siteName={siteName} tagline={t('app.tagline')} right={t('dashboard.autoRefresh', { seconds: 10 })} />
    </div>
  );
}
