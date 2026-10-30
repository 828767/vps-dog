import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** User-facing preference; `auto` follows `prefers-color-scheme`. */
export type ThemeMode = 'light' | 'dark' | 'auto';

/** What is actually painted right now. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'vpsdog.theme';

export const THEME_MODES: readonly ThemeMode[] = ['auto', 'light', 'dark'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto';
}

export function readStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}

export function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** Applies `.dark` + `color-scheme` to `<html>`. Also used by the boot script. */
export function applyTheme(resolved: ResolvedTheme): void {
  const el = document.documentElement;
  el.classList.toggle('dark', resolved === 'dark');
  el.style.colorScheme = resolved;
}

/* ── provider ─────────────────────────────────────────────────────────────── */

export interface ThemeContextValue {
  /** The stored preference (`auto` | `light` | `dark`). */
  mode: ThemeMode;
  /** The theme actually rendered. */
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Cycles auto → light → dark → auto. */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // Follow the OS while the preference is `auto`.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    storeTheme(next);
  }, []);

  const cycle = useCallback(() => {
    setModeState((current) => {
      const next: ThemeMode = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
      storeTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, cycle }),
    [mode, resolved, setMode, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** Inline SVG favicon that matches the active theme accent. */
export function themeColorScheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
