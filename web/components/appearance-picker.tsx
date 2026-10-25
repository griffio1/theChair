"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "pride";
const themes: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "pride", label: "Pride" },
];
const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark" || value === "pride";

function ThemeIcon({ theme }: { theme: Theme }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      {theme === "light" ? <>
        <circle cx="12" cy="12" r="3.8" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4L19 5" />
      </> : theme === "dark" ? (
        <path d="M20.6 14A8.7 8.7 0 0 1 10 3.4 8.8 8.8 0 1 0 20.6 14Z" />
      ) : <>
        <path d="M2 19v-4a10 10 0 0 1 20 0v4" stroke="#da4776" />
        <path d="M5.5 19v-4a6.5 6.5 0 0 1 13 0v4" stroke="#d49a28" />
        <path d="M9 19v-4a3 3 0 0 1 6 0v4" stroke="#4b91d2" />
      </>}
    </svg>
  );
}

/** Shared by the live dashboard and the workspace preview. */
export function AppearancePicker() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // The layout applies the preference before first paint; reuse that decision.
    const applied = document.documentElement.dataset.theme;
    if (isTheme(applied)) {
      setTheme(applied);
      return;
    }
    let preferred: Theme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    try {
      const saved = localStorage.getItem("thechair:theme");
      if (isTheme(saved)) preferred = saved;
    } catch {}
    document.documentElement.dataset.theme = preferred;
    setTheme(preferred);
  }, []);

  function change(next: Theme) {
    document.documentElement.dataset.theme = next;
    setTheme(next);
    try {
      localStorage.setItem("thechair:theme", next);
    } catch {}
  }

  return (
    <label className="theme-toggle" title="Choose appearance">
      <ThemeIcon theme={theme} />
      <select className="theme-select" aria-label="Appearance" value={theme}
        onChange={(event) => { if (isTheme(event.target.value)) change(event.target.value); }}>
        {themes.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  );
}
