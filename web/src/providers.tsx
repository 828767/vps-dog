import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './components/Toast';

/** Live dashboards refetch constantly; keep retries low so failures surface fast. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: true,
        staleTime: 5_000,
        gcTime: 5 * 60_000,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export interface AppProvidersProps {
  children: ReactNode;
  client?: QueryClient;
}

export function AppProviders({ children, client }: AppProvidersProps): ReactNode {
  return (
    <QueryClientProvider client={client ?? createQueryClient()}>
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
