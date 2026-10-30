import type { ReactNode } from 'react';
import { countryFlag } from '../lib/format';

/**
 * Country flag glyph for an ISO-3166 alpha-2 code.
 *
 * Windows (and therefore every Chromium browser on it) ships no glyphs for the
 * regional-indicator pairs that make up flag emoji, so `🇺🇸` renders as two
 * letters. A 78 KB font containing exactly those glyphs is vendored into the
 * bundle and applied here — deliberately local rather than the usual CDN
 * polyfill, so the dashboard keeps working offline and leaks nothing to a
 * third party.
 *
 * Codes without a flag (or a malformed value) fall back to the plain code text,
 * which is still useful information.
 */
export function CountryFlag({ code, className = '' }: { code: string; className?: string }): ReactNode {
  const glyph = countryFlag(code);
  if (glyph === '') return null;
  return (
    <span
      className={`inline-block shrink-0 leading-none ${className}`}
      style={{ fontFamily: 'Twemoji Country Flags, sans-serif' }}
      aria-hidden="true"
      title={code.toUpperCase()}
    >
      {glyph}
    </span>
  );
}
