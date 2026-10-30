/**
 * Formatting helpers. Everything is defensive: the dashboard must never render
 * `undefined`, `NaN` or `Infinity` even when the worker omits a field.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/** Languages the duration/relative formatters know about. */
export type FmtLang = 'en' | 'zh-CN';

/** Unit suffixes per language; `en` keeps the compact `16d 4h` shape. */
const DURATION_SUFFIX: Record<FmtLang, Record<string, string>> = {
  en: { d: 'd', h: 'h', m: 'm', s: 's' },
  'zh-CN': { d: '天', h: '小时', m: '分', s: '秒' },
};

const RELATIVE_SUFFIX: Record<FmtLang, Record<string, string>> = {
  en: { y: 'y', mo: 'mo', w: 'w', d: 'd', h: 'h', m: 'm', s: 's' },
  'zh-CN': { y: '年', mo: '个月', w: '周', d: '天', h: '小时', m: '分钟', s: '秒' },
};

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampPercent(value: unknown): number {
  const n = finite(value, 0);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/** `1536` → `"1.5 KB"` (binary units, 1024-based). */
export function bytes(value: number | null | undefined, digits = 1): string {
  let n = finite(value, 0);
  if (n <= 0) return '0 B';
  const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), BYTE_UNITS.length - 1);
  n /= 1024 ** exp;
  const fixed = exp === 0 ? n.toFixed(0) : n.toFixed(n >= 100 ? 0 : digits);
  return `${fixed} ${BYTE_UNITS[exp]}`;
}

/** Split form for tiles: `{"value": "1.5", "unit": "GB"}`. */
export function bytesParts(value: number | null | undefined): { value: string; unit: string } {
  const rendered = bytes(value);
  const [num = '0', unit = 'B'] = rendered.split(' ');
  return { value: num, unit };
}

/** Bytes-per-second → `"1.5 MB/s"`. */
export function rate(value: number | null | undefined): string {
  const n = finite(value, 0);
  if (n <= 0) return '0 B/s';
  return `${bytes(n)}/s`;
}

/** Split form for `rx/tx` chips. */
export function rateParts(value: number | null | undefined): { value: string; unit: string } {
  const rendered = rate(value);
  const [num = '0', unit = 'B/s'] = rendered.split(' ');
  return { value: num, unit };
}

/** `12.34` → `"12.3%"`; null/NaN → `"–"` when `dash` is true, else `"0%"`. */
export function percent(value: number | null | undefined, digits = 1, dash = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return dash ? '–' : `0${digits > 0 ? '.' + '0'.repeat(digits) : ''}%`;
  }
  return `${clampPercent(value).toFixed(digits)}%`;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Memory/disk percentage that never divides by zero. */
export function ratioPercent(used: number | null | undefined, total: number | null | undefined): number {
  const u = finite(used, 0);
  const t = finite(total, 0);
  if (t <= 0) return 0;
  return clampPercent((u / t) * 100);
}

/** Fixed-decimal number with a dash fallback. */
export function number(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return value.toFixed(digits);
}

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('en-US');
}

const DURATION_UNITS: Array<{ seconds: number; key: string }> = [
  { seconds: 86400, key: 'd' },
  { seconds: 3600, key: 'h' },
  { seconds: 60, key: 'm' },
  { seconds: 1, key: 's' },
];

/**
 * Compact duration, e.g. `"12d 4h"` / `"12天 4小时"` / `"45s"`.
 * Zero-valued leading units are skipped, and `parts` is capped so cards stay on
 * one line.
 */
export function duration(value: number | null | undefined, parts = 2, lang: FmtLang = 'en'): string {
  const total0 = Math.floor(finite(value, 0));
  const zero = lang === 'zh-CN' ? '0秒' : '0s';
  if (total0 <= 0) return zero;
  const suffix = DURATION_SUFFIX[lang];
  let total = total0;
  const out: string[] = [];
  for (const unit of DURATION_UNITS) {
    if (out.length >= parts) break;
    const count = Math.floor(total / unit.seconds);
    if (count > 0) {
      out.push(`${count}${suffix[unit.key]}`);
      total -= count * unit.seconds;
    }
  }
  return out.length > 0 ? out.join(' ') : zero;
}

/** Alias used by the node cards for `uptime`. */
export const uptime = duration;

/** Full duration for tooltips: `"12d 4h 3m 9s"`. */
export function durationLong(value: number | null | undefined, lang: FmtLang = 'en'): string {
  return duration(value, 4, lang);
}

const RELATIVE_UNITS: Array<{ seconds: number; key: string }> = [
  { seconds: 31536000, key: 'y' },
  { seconds: 2592000, key: 'mo' },
  { seconds: 604800, key: 'w' },
  { seconds: 86400, key: 'd' },
  { seconds: 3600, key: 'h' },
  { seconds: 60, key: 'm' },
  { seconds: 1, key: 's' },
];

/** `"3m ago"` / `"3分钟前"` / `"just now"` / `"刚刚"`, from epoch seconds. */
export function relativeTime(
  ts: number | null | undefined,
  now = Date.now(),
  lang: FmtLang = 'en',
): string {
  const justNow = lang === 'zh-CN' ? '刚刚' : 'just now';
  if (ts === null || ts === undefined || !Number.isFinite(ts) || ts <= 0) return '–';
  const delta = Math.round(now / 1000 - ts);
  const abs = Math.abs(delta);
  if (abs < 5) return justNow;
  const suffix = RELATIVE_SUFFIX[lang];
  for (const unit of RELATIVE_UNITS) {
    if (abs >= unit.seconds) {
      const count = Math.floor(abs / unit.seconds);
      const label = `${count}${suffix[unit.key]}`;
      if (lang === 'zh-CN') return delta >= 0 ? `${label}前` : `${label}后`;
      return delta >= 0 ? `${label} ago` : `in ${label}`;
    }
  }
  return justNow;
}

/** Epoch seconds → local `"2026-10-05 20:54:04"`. */
export function dateTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts) || ts <= 0) return '–';
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Epoch seconds → `"20:54"` (axis labels). */
export function clockTime(ts: number, withSeconds = false): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return withSeconds
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Epoch seconds → `"10-05 20:54"` for multi-day ranges. */
export function shortDateTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Latency in ms, `-1`/null means "no data". */
export function ms(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '–';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(digits)} ms`;
}

/** Round-trip numbers into a compact axis label (`1.5G`, `320M`). */
export function axisBytes(value: number): string {
  const n = finite(value, 0);
  if (n === 0) return '0';
  const exp = Math.min(Math.floor(Math.log(Math.abs(n)) / Math.log(1024)), BYTE_UNITS.length - 1);
  const scaled = n / 1024 ** exp;
  return `${scaled >= 100 || exp === 0 ? scaled.toFixed(0) : scaled.toFixed(1)}${BYTE_UNITS[exp]}`;
}

/** Threshold colour token: green → amber → red. */
export function thresholdTone(percentValue: number | null | undefined): 'success' | 'warn' | 'danger' {
  const p = clampPercent(percentValue);
  if (p >= 90) return 'danger';
  if (p >= 75) return 'warn';
  return 'success';
}

/** CSS colour for a tone, resolved from the live theme variables. */
export function toneColor(tone: 'success' | 'warn' | 'danger' | 'accent' | 'muted'): string {
  if (typeof window === 'undefined') return '#3b82f6';
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(`--${tone}`).trim();
  return value.length > 0 ? value : '#3b82f6';
}

/** Reads a CSS custom property from `<html>` with a fallback. */
export function cssVar(name: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

/** Truncates a long id/target for display without breaking layout. */
export function truncate(value: string, max = 32): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

/** Human quota from GB: 500 → "500 GB", 1024 → "1.0 TB". */
export function quota(gb: number): string {
  return bytes(gb * 1024 ** 3);
}

/** Whole days from now until the end of `dateStr` ('YYYY-MM-DD'); ≤ 0 when past. */
export function daysUntil(dateStr: string, nowMs: number): number {
  const end = new Date(`${dateStr}T23:59:59`).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.ceil((end - nowMs) / 86_400_000);
}

/**
 * Flag emoji for an ISO-3166 alpha-2 code ("HK" → 🇭🇰); '' when not a code.
 * Regional-indicator codepoints only — no emoji font table needed.
 */
export function countryFlag(code: string): string {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
