import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

/** The mark's rounded tile, by context. `sm` is the sidebar scale. */
export type BrandSize = 'sm' | 'md';

const TILE: Record<BrandSize, string> = {
  sm: 'size-7 rounded-lg',
  md: 'size-8 rounded-[10px]',
};

const GLYPH: Record<BrandSize, string> = {
  sm: 'size-4',
  md: 'size-5',
};

export interface LogoMarkProps {
  size?: BrandSize;
}

/**
 * The project mark — a dog-eared server on a solid accent tile.
 *
 * Single source of truth: it used to be copy-pasted into the public header, the
 * admin sidebar and the sign-in screen, and the three copies had drifted apart
 * (7px vs 8px tile, 1.8 vs 1.6 stroke, tinted vs solid fill).
 */
export function LogoMark({ size = 'md' }: LogoMarkProps): ReactNode {
  return (
    <span
      className={`flex ${TILE[size]} shrink-0 items-center justify-center bg-accent text-bg`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className={GLYPH[size]} fill="none">
        <path
          d="M5 8.2 8.4 4h7.2L19 8.2V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8.2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M5 12h14M9.5 15.6h.01M14.5 15.6h.01"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export interface BrandProps {
  name: string;
  /** Shown inline after the wordmark; hidden below `sm`. */
  description?: string;
  to?: string;
  size?: BrandSize;
}

/** Logo + wordmark + optional tagline, linking home. Shared by both shells. */
export function Brand({ name, description, to = '/', size = 'md' }: BrandProps): ReactNode {
  const hasDescription = description !== undefined && description.length > 0;
  return (
    <Link
      to={to}
      className="flex min-w-0 items-center gap-2.5 rounded-lg transition-opacity duration-150 hover:opacity-85"
    >
      <LogoMark size={size} />
      <span className="truncate text-[17px] leading-none font-semibold tracking-tight text-text">
        {name}
      </span>
      {hasDescription ? (
        <span className="hidden truncate text-xs text-muted sm:inline">{description}</span>
      ) : null}
    </Link>
  );
}
