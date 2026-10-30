/**
 * Shared pill chrome — the header's control shape.
 *
 * Exported so `Button`'s `pill` variants and the header controls cannot drift
 * apart: they are literally the same strings.
 */
export const PILL_BASE =
  'inline-flex h-8.5 items-center rounded-xl border transition-colors duration-150';

/**
 * Fill, chosen by the surface the pill sits on. The public header floats on the
 * page canvas, so a `surface`-filled chip reads as raised; inside the admin
 * sidebar (already `bg-surface`) the chip has to step *up* to `surface-2`
 * instead, or it disappears into its own background.
 */
export const PILL_FILL = {
  canvas: 'bg-surface',
  surface: 'bg-surface-2',
} as const;

export type PillSurface = keyof typeof PILL_FILL;

/** Border colour and text treatment; pair with `PILL_BASE` and a fill. */
export const PILL_IDLE = 'border-border text-muted hover:border-muted/40 hover:text-text';

/** Selected pill, used by nav links. */
export const PILL_ACTIVE = 'border-accent/40 bg-accent/12 text-accent';
