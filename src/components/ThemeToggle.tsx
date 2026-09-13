'use client';
// ── Theme: system → light → dark, remembered per device ───────────────────
// The stored value is read by an inline script in layout.tsx before first
// paint, so a dark-mode user never gets a white flash at 1am.
import React, { useEffect, useState } from 'react';

export type Theme = 'system' | 'light' | 'dark';
const ORDER: Theme[] = ['system', 'light', 'dark'];
const LABEL: Record<Theme, string> = { system: 'Match system', light: 'Light', dark: 'Dark' };

function apply(t: Theme) {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
  try { localStorage.setItem('academai-theme', t); } catch { /* private mode */ }
}

export default function ThemeToggle() {
  // Start at 'system' on both server and client, then reconcile after mount —
  // reading localStorage during render would desync hydration.
  const [theme, setTheme] = useState<Theme>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: Theme = 'system';
    try {
      const v = localStorage.getItem('academai-theme');
      if (v === 'light' || v === 'dark' || v === 'system') stored = v;
    } catch { /* private mode */ }
    setTheme(stored);
    setReady(true);
  }, []);

  const next = () => {
    const t = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(t);
    apply(t);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={next}
      aria-label={`Theme: ${LABEL[theme]}. Activate to change.`}
      title={`Theme: ${LABEL[theme]}`}
    >
      <span aria-hidden="true" suppressHydrationWarning>
        {ready && theme === 'light' ? <SunIcon /> : ready && theme === 'dark' ? <MoonIcon /> : <SystemIcon />}
      </span>
    </button>
  );
}

/* Three glyphs, one family, 1.5 stroke — see globals.css .theme-toggle svg */
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M20.5 14.3A8.6 8.6 0 0 1 9.7 3.5a8.6 8.6 0 1 0 10.8 10.8Z" />
    </svg>
  );
}
function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="2.8" y="4.2" width="18.4" height="12.6" rx="2" />
      <path d="M8.5 20.3h7" />
    </svg>
  );
}
