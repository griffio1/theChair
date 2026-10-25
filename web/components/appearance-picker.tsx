"use client";

import { useEffect, useRef, useState } from "react";

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
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    picker.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    function closeOutside(event: PointerEvent) {
      if (!picker.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

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
    <div className="theme-picker" ref={picker}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button className="theme-toggle" type="button" ref={trigger}
        aria-label={`Appearance: ${themes.find(item => item.value === theme)?.label}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        }}>
        <ThemeIcon theme={theme} />
        <span>{themes.find(item => item.value === theme)?.label}</span>
        <svg className="theme-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div className="theme-menu" role="menu" aria-label="Appearance"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
          const index = options.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? (index + 1) % options.length
            : event.key === "ArrowUp" ? (index - 1 + options.length) % options.length
            : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); options[next]?.focus(); }
        }}>
        {themes.map(({ value, label }) => <button type="button" key={value}
          role="menuitemradio" aria-checked={theme === value} tabIndex={theme === value ? 0 : -1}
          onClick={() => { change(value); setOpen(false); trigger.current?.focus(); }}>
          <ThemeIcon theme={value} /><span>{label}</span>
          {theme === value && <svg className="theme-check" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>)}
      </div>}
    </div>
  );
}
