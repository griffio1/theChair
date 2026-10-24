// Shape extractor (M8). Gemini with a JSON schema, cached by commit SHA.
// Auto mode falls back after 8 seconds; explicit Gemini checks allow 30 seconds.
// EXTRACTOR=auto (default) | gemini | deterministic

import type { ExtractedShape } from "../shared/types";
import { extractDeterministic } from "./deterministic";
import { select, upsert } from "../server/db";

const FIELD = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    type: { type: "STRING", enum: ["string", "number", "boolean", "object", "array", "null", "unknown"] },
    required: { type: "BOOLEAN" },
  },
  required: ["name", "type", "required"],
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    shapes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          role: { type: "STRING", enum: ["producer", "consumer"] },
          method: { type: "STRING", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "STRING" },
          requestFields: { type: "ARRAY", items: FIELD },
          responseFields: { type: "ARRAY", items: FIELD },
          evidence: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { line: { type: "INTEGER" }, snippet: { type: "STRING" } },
              required: ["line", "snippet"],
            },
          },
        },
        required: ["role", "method", "path", "requestFields", "responseFields", "evidence"],
      },
    },
  },
  required: ["shapes"],
};

const PROMPT = `You extract HTTP API shapes from one source file.
- A "producer" defines an endpoint (e.g. an Express/Next.js handler). requestFields = fields it reads from the JSON body; responseFields = fields it returns in JSON.
- A "consumer" calls an endpoint (e.g. fetch/axios). requestFields = fields it sends; responseFields = fields it reads from the JSON response.
- Describe only the successful (2xx) contract. Exclude fields returned only by 4xx/5xx error branches, such as res.status(401).json({ error: ... }). Do not merge error fields into success responses or emit separate shapes for error branches.
- Set required relative to the successful request/response, not across success and error branches. A field always returned on success is required even if an error branch omits it. For consumers, fields unconditionally sent or read are required.
- Use the exact field names as written in the code. Do not normalize casing.
- Use "unknown" when a type is not obvious. Paths start with "/" and keep route params like ":id".
- evidence: 1-based line numbers and the exact line of code.
- If the file has no HTTP API code, return {"shapes": []}.`;

async function gemini(file: string, text: string, timeoutMs: number): Promise<ExtractedShape[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
  const numbered = text
    .split("\n")
    .map((l, i) => `${i + 1}: ${l}`)
    .join("\n");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: PROMPT }] },
          contents: [{ role: "user", parts: [{ text: `File: ${file}\n\n${numbered}` }] }],
          generationConfig: {
            // Gemini 3 no longer accepts the legacy sampling parameters.
            ...(!model.startsWith("gemini-3") ? { temperature: 0 } : {}),
            responseMimeType: "application/json",
            responseSchema: SCHEMA,
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"shapes":[]}';
    const parsed = JSON.parse(raw) as { shapes: Omit<ExtractedShape, "file">[] };
    return parsed.shapes.map((s) => ({ ...s, file }));
  } finally {
    clearTimeout(timer);
  }
}

export interface ExtractResult {
  shapes: ExtractedShape[];
  source: "cache" | "gemini" | "deterministic";
}

export async function extractShapes(file: string, text: string, sha?: string): Promise<ExtractResult> {
  if (sha) {
    try {
      const [hit] = await select<{ shapes: ExtractedShape[] }>(
        "extraction_cache",
        `sha=eq.${sha}&file=eq.${encodeURIComponent(file)}`,
      );
      if (hit) return { shapes: hit.shapes, source: "cache" };
    } catch {
      /* cache is best-effort */
    }
  }

  const mode = process.env.EXTRACTOR ?? "auto";
  let result: ExtractResult;
  if (mode === "deterministic") {
    result = { shapes: extractDeterministic(file, text), source: "deterministic" };
  } else {
    try {
      result = { shapes: await gemini(file, text, mode === "gemini" ? 30000 : 8000), source: "gemini" };
    } catch (e) {
      if (mode === "gemini") throw e;
      console.warn(`[extract] Gemini failed for ${file}, using deterministic: ${(e as Error).message}`);
      result = { shapes: extractDeterministic(file, text), source: "deterministic" };
    }
  }

  if (sha) {
    try {
      await upsert("extraction_cache", { sha, file, shapes: result.shapes });
    } catch {
      /* best-effort */
    }
  }
  return result;
}
