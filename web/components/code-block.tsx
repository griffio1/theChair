"use client";
import { useState, type ReactNode } from "react";

// Lightweight syntax colouring for the languages the chat AI writes (TS/JS, JSON, shell,
// Python, SQL, HTTP). One tokenizer for all of them: good enough to read, no dependency.

const KEYWORDS = new Set(
  (
    "const let var function return if else for while do switch case break continue new class extends " +
    "import export from default async await try catch finally throw typeof instanceof in of interface type " +
    "enum implements public private protected readonly static void def lambda pass elif with as yield " +
    "select insert update delete into values where join left right inner on group by order limit create table " +
    "alter drop and or not null true false undefined none nil echo cd export npm npx git curl get post put patch"
  ).split(" "),
);

const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?<![\w$])#(?![!{])[^\n]*)|("(?:[^"\\\n]|\\.)*"(?=\s*:))|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$-]*)/g;

export function highlight(code: string, lang = ""): ReactNode[] {
  const hashComments = /^(sh|bash|zsh|shell|console|py|python|yaml|yml|toml|rb|ruby)$/i.test(lang);
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of code.matchAll(TOKEN)) {
    const [token, comment, key, string, number, call, word] = match;
    const at = match.index ?? 0;
    let kind = "";
    if (comment) kind = comment.startsWith("#") && !hashComments ? "" : "comment";
    else if (key) kind = "key";
    else if (string) kind = "string";
    else if (number) kind = "number";
    else if (call) kind = KEYWORDS.has(call.toLowerCase()) ? "keyword" : "call";
    else if (word) kind = KEYWORDS.has(word.toLowerCase()) ? "keyword" : /^[A-Z][a-z]/.test(word) ? "type" : "";
    if (!kind) continue;
    if (at > last) out.push(code.slice(last, at));
    out.push(<span key={at} className={`tok-${kind}`}>{token}</span>);
    last = at + token.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (insecure context, permissions); the code stays selectable.
    }
  }
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span>{lang || "code"}</span>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre><code>{highlight(code, lang)}</code></pre>
    </div>
  );
}
