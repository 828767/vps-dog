import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Button } from '../components/Button';
import { useI18n } from '../lib/i18n';

export default function NotFound(): ReactNode {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
      <p className="num text-5xl font-semibold tracking-tight text-muted/45">404</p>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold text-text">{t('notFound.title')}</h1>
        <p className="max-w-sm text-sm text-muted">{t('notFound.hint')}</p>
      </div>
      <Link to="/">
        <Button variant="primary">{t('notFound.home')}</Button>
      </Link>
    </div>
  );
}
