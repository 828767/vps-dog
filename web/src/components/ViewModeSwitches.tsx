import type { ReactNode } from 'react';
import { useI18n } from '../lib/i18n';

/** How much of each node card is shown. */
export type LayoutMode = 'detailed' | 'compact';

/** How the CPU / memory / disk tiles draw their meter. */
export type MeterStyle = 'bar' | 'ring';

export const LAYOUT_STORAGE_KEY = 'vpsdog.layout';
export const METER_STORAGE_KEY = 'vpsdog.meters';

/**
 * Read the persisted layout. `vpsdog.meters` used to hold a three-way value
 * including `compact`, so an old value there is honoured as the layout choice
 * — otherwise a stored `compact` would silently fall back to detailed.
 */
export function readLayoutMode(): LayoutMode {
  try {
    if (localStorage.getItem(METER_STORAGE_KEY) === 'compact') return 'compact';
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'compact' ? 'compact' : 'detailed';
  } catch {
    return 'detailed';
  }
}

export function writeLayoutMode(mode: LayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
  } catch {
    // Private mode / storage disabled — the preference just won't persist.
  }
}

/** Read the persisted meter style; anything unknown falls back to bars. */
export function readMeterStyle(): MeterStyle {
  try {
    return localStorage.getItem(METER_STORAGE_KEY) === 'ring' ? 'ring' : 'bar';
  } catch {
    return 'bar';
  }
}

export function writeMeterStyle(style: MeterStyle): void {
  try {
    // Overwrites any legacy `compact` value, so readLayoutMode() stops
    // consulting this key once the new layout key is in play.
    localStorage.setItem(METER_STORAGE_KEY, style);
  } catch {
    // Private mode / storage disabled — the preference just won't persist.
  }
}

/** Shared chrome for the two segmented controls. */
function Segmented<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}): ReactNode {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 ${
              active ? 'bg-success/14 text-success' : 'text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface LayoutModeSwitchProps {
  value: LayoutMode;
  onChange: (next: LayoutMode) => void;
}

/** Detailed (full card) vs compact (meters only, several per row). */
export function LayoutModeSwitch({ value, onChange }: LayoutModeSwitchProps): ReactNode {
  const { t } = useI18n();
  return (
    <Segmented
      ariaLabel={t('dashboard.layoutMode')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'detailed', label: t('dashboard.layoutDetailed') },
        { value: 'compact', label: t('dashboard.layoutCompact') },
      ]}
    />
  );
}

export interface MeterStyleSwitchProps {
  value: MeterStyle;
  onChange: (next: MeterStyle) => void;
}

/** Bars vs rings — applies to both the detailed and the compact layout. */
export function MeterStyleSwitch({ value, onChange }: MeterStyleSwitchProps): ReactNode {
  const { t } = useI18n();
  return (
    <Segmented
      ariaLabel={t('dashboard.meterStyle')}
      value={value}
      onChange={onChange}
      options={[
        { value: 'bar', label: t('dashboard.meterBar') },
        { value: 'ring', label: t('dashboard.meterRing') },
      ]}
    />
  );
}
