import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '../../components/Brand';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { FormError } from '../../components/Notice';
import { useToast } from '../../components/Toast';
import { ApiError, authApi, errorMessage, qk } from '../../lib/api';
import { useI18n } from '../../lib/i18n';

/** `/admin` — sign-in form. Redirects to `/admin/nodes` when a session exists. */
export default function AdminLogin(): ReactNode {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => authApi.me(signal),
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (meQuery.data !== undefined) {
      void navigate('/admin/nodes', { replace: true });
    }
  }, [meQuery.data, navigate]);

  const login = useMutation({
    mutationFn: () => authApi.login(username.trim(), password),
    onSuccess: (data) => {
      setFormError(null);
      setPassword('');
      queryClient.setQueryData(qk.me, { user: data.user });
      if (data.bootstrap === true) toast.success(t('login.bootstrap'));
      else toast.success(t('toast.saved'));
      void navigate('/admin/nodes', { replace: true });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 429) {
        setFormError(t('login.rateLimited'));
      } else if (error instanceof ApiError && error.status === 401) {
        setFormError(t('login.failed'));
      } else {
        setFormError(errorMessage(error));
      }
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (username.trim().length === 0 || password.length === 0) {
      setFormError(t('login.failed'));
      return;
    }
    login.mutate();
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4 py-10">
      <Brand name={t('app.name')} />

      <div className="card w-full max-w-sm p-6">
        <header className="flex flex-col gap-1 pb-5">
          <h1 className="text-base font-semibold text-text">{t('login.title')}</h1>
          <p className="text-xs leading-relaxed text-muted">{t('login.subtitle')}</p>
        </header>

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input
            label={t('login.username')}
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            autoFocus
          />
          <Input
            label={t('login.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {formError !== null ? <FormError message={formError} /> : null}

          <Button type="submit" variant="primary" block loading={login.isPending}>
            {login.isPending ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>

        <p className="pt-4 text-[11px] leading-relaxed text-muted/85">{t('login.defaultHint')}</p>
      </div>

      <Link
        to="/"
        className="text-xs text-muted transition-colors duration-150 hover:text-text"
      >
        {t('admin.backToSite')}
      </Link>
    </div>
  );
}
