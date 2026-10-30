import type { ReactNode } from 'react';

export interface AppFooterProps {
  siteName: string;
  /** Middle segment; defaults to the app tagline. */
  tagline?: string;
  /** Right-hand slot. Omit to render the left side only. */
  right?: ReactNode;
}

/**
 * Site footer. Shared by the public dashboard and the admin shell so both end
 * the same way.
 */
export function AppFooter({ siteName, tagline, right }: AppFooterProps): ReactNode {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-1.5 px-4 py-5 text-[11px] text-muted sm:flex-row sm:px-6">
        <p className="flex items-center gap-1.5">
          <span className="font-medium text-text/80">{siteName}</span>
          <span aria-hidden="true">·</span>
          <span>{tagline}</span>
        </p>
        {right !== undefined ? <p className="num">{right}</p> : null}
      </div>
    </footer>
  );
}
