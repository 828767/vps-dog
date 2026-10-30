import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

/** Hours offered by the traffic/history range switch. */
export const RANGE_HOURS = [1, 6, 24, 168] as const;
export type RangeHours = (typeof RANGE_HOURS)[number];

export const RANGE_LABEL_KEY = {
  1: 'detail.range.1h',
  6: 'detail.range.6h',
  24: 'detail.range.24h',
  168: 'detail.range.7d',
} as const;

export const RANGE_SHORT_KEY = {
  1: 'detail.range.1h.short',
  6: 'detail.range.6h.short',
  24: 'detail.range.24h.short',
  168: 'detail.range.7d.short',
} as const;

export interface RangeSwitchProps {
  value: RangeHours;
  onChange: (next: RangeHours) => void;
  /** `sm` is the inline size used inside node cards. */
  size?: 'sm' | 'md';
}

/** Segmented control for the chart's time window. */
export function RangeSwitch({ value, onChange, size = 'md' }: RangeSwitchProps): ReactNode {
  const { t } = useI18n();
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  return (
    <div
      role="group"
      aria-label={t('detail.rangeLabel')}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {RANGE_HOURS.map((range) => {
        const active = range === value;
        return (
          <button
            key={range}
            type="button"
            onClick={() => onChange(range)}
            aria-pressed={active}
            title={t(RANGE_LABEL_KEY[range])}
            className={`num rounded-md font-medium transition-colors duration-150 ${padding} ${
              active ? 'bg-success/14 text-success' : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {t(RANGE_SHORT_KEY[range])}
          </button>
        );
      })}
    </div>
  );
}
