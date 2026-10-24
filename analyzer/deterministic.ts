// Deterministic extractor for the demo app's patterns (Express handlers, fetch calls).
// It is the fallback when Gemini is slow or down, and it makes the demo repeatable.
// Scope: TypeScript/JavaScript HTTP APIs with JSON bodies. Anything else -> no shapes.

import type { ExtractedShape, FieldSpec, HttpMethod } from "../shared/types";

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;
const snippetAt = (text: string, index: number) => text.split("\n")[lineOf(text, index) - 1]?.trim() ?? "";

/** Top-level keys of an object literal body like `userId: user.id, token, ...rest`. */
export function objectKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if ("{[(".includes(ch)) depth++;
    if ("}])".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      keys.push(current);
      current = "";
    } else current += ch;
  }
  keys.push(current);
  return keys
    .map((k) => k.trim())
    .filter((k) => k && !k.startsWith("..."))
    .map((k) => {
      const m = /^["']?([A-Za-z_$][\w$]*)["']?\s*(?::|$)/.exec(k);
      return m ? m[1] : "";
    })
    .filter(Boolean);
}

/** Return the text inside the braces that open at `open` (index of "{"). */
function braced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

function literalType(expr: string): FieldSpec["type"] {
  const e = expr.trim();
  if (/^["'`]/.test(e)) return "string";
  if (/^-?\d/.test(e)) return "number";
  if (/^(true|false)$/.test(e)) return "boolean";
  if (e === "null") return "null";
  if (e.startsWith("[")) return "array";
  if (e.startsWith("{")) return "object";
  if (/^String\(/.test(e)) return "string";
  if (/^Number\(/.test(e)) return "number";
  return "unknown";
}

function fieldsFromObject(body: string): FieldSpec[] {
  const out: FieldSpec[] = [];
  for (const key of objectKeys(body)) {
    const m = new RegExp(`(?:^|,|\\{)\\s*["']?${key}["']?\\s*:\\s*([^,}]+)`).exec(body);
    out.push({ name: key, type: m ? literalType(m[1]) : "unknown", required: true });
  }
  return out;
}

const uniq = (fs: FieldSpec[]) => [...new Map(fs.map((f) => [f.name, f])).values()];

/** Express: app.post("/path", ...) or router.post(...). */
function producers(file: string, text: string): ExtractedShape[] {
  const out: ExtractedShape[] = [];
  const re = /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  const starts: { index: number; method: HttpMethod; path: string }[] = [];
  for (let m; (m = re.exec(text)); ) starts.push({ index: m.index, method: m[1].toUpperCase() as HttpMethod, path: m[2] });

  starts.forEach((s, i) => {
    const body = text.slice(s.index, starts[i + 1]?.index ?? text.length);
    const evidence = [{ line: lineOf(text, s.index), snippet: snippetAt(text, s.index) }];

    const requestFields: FieldSpec[] = [];
    for (const m of body.matchAll(/const\s*\{([^}]*)\}\s*=\s*req\.body/g)) {
      for (const k of objectKeys(m[1])) requestFields.push({ name: k, type: "unknown", required: true });
    }
    for (const m of body.matchAll(/req\.body\.([A-Za-z_$][\w$]*)/g)) {
      requestFields.push({ name: m[1], type: "unknown", required: true });
    }

    const responseFields: FieldSpec[] = [];
    for (const m of body.matchAll(/res(?:\.status\(([^)]*)\))?\.(?:json|send)\(\s*\{/g)) {
      // Error responses (4xx/5xx) aren't part of the success contract.
      if (m[1] && /^\s*[45]\d\d\s*$/.test(m[1])) continue;
      const open = s.index + m.index! + m[0].length - 1;
      responseFields.push(...fieldsFromObject(braced(text, open)));
      evidence.push({ line: lineOf(text, open), snippet: snippetAt(text, open) });
    }

    out.push({
      file,
      role: "producer",
      method: s.method,
      path: s.path,
      requestFields: uniq(requestFields),
      responseFields: uniq(responseFields),
      evidence,
    });
  });
  return out;
}

/** fetch("/path", { method, body: JSON.stringify({...}) }) and the fields read from its JSON. */
function consumers(file: string, text: string): ExtractedShape[] {
  const out: ExtractedShape[] = [];
  const re = /fetch\(\s*(["'`])([^"'`]*\/api\/[^"'`]*)\1\s*(?:,\s*\{)?/g;
  for (let m; (m = re.exec(text)); ) {
    const path = m[2];
    const rest = text.slice(m.index, m.index + 1500);
    const method = ((/method:\s*["'](\w+)["']/.exec(rest)?.[1] ?? "GET").toUpperCase()) as HttpMethod;

    const requestFields: FieldSpec[] = [];
    const sm = /JSON\.stringify\(\s*\{/.exec(rest);
    if (sm) requestFields.push(...fieldsFromObject(braced(rest, sm.index + sm[0].length - 1)));

    const responseFields: FieldSpec[] = [];
    const evidence = [{ line: lineOf(text, m.index), snippet: snippetAt(text, m.index) }];
    // const data = await res.json();  -> data.userId
    const varM = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[\w$.]+\.json\(\)/.exec(rest);
    if (varM) {
      const v = varM[1];
      for (const r of rest.matchAll(new RegExp(`\\b${v}\\.([A-Za-z_$][\\w$]*)`, "g"))) {
        responseFields.push({ name: r[1], type: "unknown", required: true });
        const at = m.index + r.index!;
        evidence.push({ line: lineOf(text, at), snippet: snippetAt(text, at) });
      }
    }
    // const { userId } = await res.json();
    const destr = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+[\w$.]+\.json\(\)/.exec(rest);
    if (destr) for (const k of objectKeys(destr[1])) responseFields.push({ name: k, type: "unknown", required: true });

    out.push({ file, role: "consumer", method, path, requestFields: uniq(requestFields), responseFields: uniq(responseFields), evidence });
  }
  return out;
}

export function extractDeterministic(file: string, text: string): ExtractedShape[] {
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) return [];
  return [...producers(file, text), ...consumers(file, text)];
}
