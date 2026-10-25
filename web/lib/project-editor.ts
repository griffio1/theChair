export type TextFormat = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link";

/** Keep the selected text selected after a toolbar action so typing stays predictable. */
export function formatProjectText(text: string, start: number, end: number, format: TextFormat) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  if (format === "heading" || format === "bullets" || format === "numbers") {
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = text.indexOf("\n", Math.max(from, to - 1));
    const until = lineEnd < 0 ? text.length : lineEnd;
    const lines = text.slice(lineStart, until).split("\n");
    const replacement = lines.map((line, i) => `${format === "heading" ? "## " : format === "bullets" ? "- " : `${i + 1}. `}${line}`).join("\n");
    return {text: text.slice(0, lineStart) + replacement + text.slice(until), start: lineStart, end: lineStart + replacement.length};
  }
  const selected = text.slice(from, to) || (format === "link" ? "Link text" : "Text");
  const prefix = format === "bold" ? "**" : format === "italic" ? "*" : "[";
  const suffix = format === "link" ? "](https://example.com)" : prefix;
  const replacement = prefix + selected + suffix;
  const selectionStart = from + prefix.length;
  return {text: text.slice(0, from) + replacement + text.slice(to), start: selectionStart, end: selectionStart + selected.length};
}

/** Recompute from the deadline rather than subtracting ticks, including after sleep. */
export function deadlineRemaining(deadline: string, now: number) {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null;
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  return {
    ended: end <= now,
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}
