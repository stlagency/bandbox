'use client';

/**
 * ThemeToggle — sets data-theme on <html>, persists to localStorage, and
 * defaults to prefers-color-scheme on first visit (DESIGN.md §Theme). The
 * pre-paint script in layout.tsx already applied the resolved theme before
 * hydration; this component reads it back so the label is correct on mount
 * (no flash, no hydration mismatch).
 *
 * Variants: "band" (bone button on the Navy band — scan) and "ink" (ink button
 * in the deep-dive header). Label reads the NEXT theme ("DARK" when light).
 */
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'pb-theme';
type Theme = 'light' | 'dark';

export interface ThemeToggleProps {
  variant?: 'band' | 'ink';
  /** "short" → DARK / LIGHT; "long" → DARK MODE / LIGHT MODE. */
  labelStyle?: 'short' | 'long';
}

export function ThemeToggle({ variant = 'band', labelStyle = 'short' }: ThemeToggleProps) {
  // Start null to avoid asserting a theme before we've read the DOM (the
  // pre-paint script is the source of truth until this mounts).
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current =
      (document.documentElement.getAttribute('data-theme') as Theme | null) ??
      'light';
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage may be unavailable (private mode) — theme still applies live */
    }
    setTheme(next);
  }

  const isDark = theme === 'dark';
  const word = isDark ? 'LIGHT' : 'DARK';
  const label = labelStyle === 'long' ? `${word} MODE` : word;
  const cls = variant === 'ink' ? 'pb-themebtn pb-themebtn--ink' : 'pb-themebtn';

  return (
    <button
      type="button"
      className={cls}
      onClick={toggle}
      aria-pressed={isDark}
      aria-label="Toggle light and dark theme"
    >
      {/* Render a stable label until mounted to avoid SSR/client mismatch. */}
      <span suppressHydrationWarning>{theme === null ? 'DARK' : label}</span>
    </button>
  );
}
