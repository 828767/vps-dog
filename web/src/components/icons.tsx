import type { ReactNode } from 'react';

/**
 * Line icons for the dashboard, drawn on a 24×24 grid and inheriting
 * `currentColor` + stroke width from the caller's classes.
 *
 * Kept in one place because the same glyph (CPU, disk, download…) appears in
 * the stat tiles, the node cards and the detail page — three copies would
 * drift apart.
 */
export interface IconProps {
  className?: string;
}

function svg(children: ReactNode, className: string): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/* ── fleet / status ───────────────────────────────────────────────────────── */

export function IconServerStack({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01" />
    </>,
    className,
  );
}

export function IconAlertTriangle({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M12 4.5 21 19.5H3L12 4.5Z" />
      <path d="M12 10v4M12 17h.01" />
    </>,
    className,
  );
}

export function IconServer({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="3" y="3.5" width="18" height="7" rx="2" />
      <path d="M3 13h18M7 17h10M7 20.5h6" />
      <path d="M7 7h.01" />
    </>,
    className,
  );
}

export function IconActivity({ className = 'size-5' }: IconProps): ReactNode {
  return svg(<path d="M3 12.5h3.5l2.5-7 4 13 2.5-6h5.5" />, className);
}

/** Globe with a check — availability of a website. */
export function IconGlobe({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.3 3.3 5 3.3 8s-1.1 5.7-3.3 8c-2.2-2.3-3.3-5-3.3-8S9.8 6.3 12 4Z" />
    </>,
    className,
  );
}

/* ── host resources ───────────────────────────────────────────────────────── */

export function IconCpu({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3" />
    </>,
    className,
  );
}

export function IconMemory({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 11v2M11 11v2M15 11v2" />
    </>,
    className,
  );
}

export function IconDisk({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M3.5 14h17" />
      <circle cx="8" cy="17.5" r="1.1" />
    </>,
    className,
  );
}

/* ── traffic ──────────────────────────────────────────────────────────────── */

export function IconDownload({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M12 3.5v10M8 9.5l4 4 4-4" />
      <path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
    className,
  );
}

export function IconUpload({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M12 13.5v-10M8 7.5l4-4 4 4" />
      <path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>,
    className,
  );
}

export function IconCalendar({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5V6M16 3.5V6" />
    </>,
    className,
  );
}

export function IconClock({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>,
    className,
  );
}

export function IconDatabase({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>,
    className,
  );
}

export function IconChart({ className = 'size-5' }: IconProps): ReactNode {
  return svg(<path d="M5 20V11M12 20V5M19 20v-6" />, className);
}

export function IconLayers({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z" />
      <path d="M3 12.5 12 17l9-4.5M3 16.5 12 21l9-4.5" />
    </>,
    className,
  );
}

export function IconNetworkCard({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="2.5" y="8" width="19" height="9" rx="2" />
      <path d="M6 11.5h2M10 11.5h2M14 11.5h2M6 14h10" />
    </>,
    className,
  );
}

export function IconChipSmall({ className = 'size-5' }: IconProps): ReactNode {
  return svg(
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M12 9.5v5M9.5 12h5" />
    </>,
    className,
  );
}

/* ── chrome ───────────────────────────────────────────────────────────────── */

export function IconGear({ className = 'size-4' }: IconProps): ReactNode {
  return svg(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.5 12H2.1M21.9 12h-2.4M6.7 6.7 5 5M19 19l-1.7-1.7M6.7 17.3 5 19M19 5l-1.7 1.7" />
    </>,
    className,
  );
}

export function IconBell({ className = 'size-4' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M18 8.6a6 6 0 1 0-12 0c0 5-2 6.4-2 6.4h16s-2-1.4-2-6.4Z" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </>,
    className,
  );
}

export function IconBellOff({ className = 'size-4' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M18 8.6a6 6 0 1 0-12 0c0 5-2 6.4-2 6.4h16s-2-1.4-2-6.4Z" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
      <path d="M3 3l14 14" />
    </>,
    className,
  );
}

export function IconShield({ className = 'size-4' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M12 2.8 19.5 5.6v5.2c0 4.2-2.9 7.9-7.5 9.4-4.6-1.5-7.5-5.2-7.5-9.4V5.6L12 2.8Z" />
      <path d="M9.1 11.9 11.3 14l3.8-3.8" />
    </>,
    className,
  );
}

export function IconRefresh({ className = 'size-4' }: IconProps): ReactNode {
  return svg(
    <>
      <path d="M20 11.5A8 8 0 0 0 5.6 6.6M4 12.5a8 8 0 0 0 14.4 4.9" />
      <path d="M20.5 5v5h-5M3.5 19v-5h5" />
    </>,
    className,
  );
}

export function IconChevronUp({ className = 'size-4' }: IconProps): ReactNode {
  return svg(<path d="M6 14.5 12 8.5l6 6" />, className);
}

export function IconChevronDown({ className = 'size-4' }: IconProps): ReactNode {
  return svg(<path d="M6 9.5 12 15.5l6-6" />, className);
}

export function IconArrowRight({ className = 'size-4' }: IconProps): ReactNode {
  return svg(<path d="M5 12h14M13 6l6 6-6 6" />, className);
}
