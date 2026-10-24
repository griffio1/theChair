"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "pride";

/** Shared by the live dashboard and the workspace preview. */
export function AppearancePicker() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    let preferred: Theme = window.matchMedia("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    try {
      const saved = localStorage.getItem("thechair:theme");
      if (saved === "light" || saved === "dark" || saved === "pride")
        preferred = saved;
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
      <span aria-hidden="true">
        {theme === "pride" ? "🌈" : theme === "dark" ? "☾" : "☀"}
      </span>
      <select
        aria-label="Appearance"
        value={theme}
        onChange={(e) => change(e.target.value as Theme)}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="pride">Pride</option>
      </select>
    </label>
  );
}
