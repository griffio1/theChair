// Run from the repo root: node --env-file=web/.env.local --import tsx analyzer/check-gemini.ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractShapes } from "./extract";
import { extractDeterministic } from "./deterministic";
import type { ExtractedShape } from "../shared/types";

// Compare endpoint roles and field names; Gemini can infer more precise types.
function signature(shapes: ExtractedShape[]) {
  return shapes.map((shape) => ({
    role: shape.role,
    method: shape.method,
    path: shape.path,
    requestFields: shape.requestFields.map((field) => field.name).sort(),
    responseFields: shape.responseFields.map((field) => field.name).sort(),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

async function main() {
  process.env.EXTRACTOR = "gemini";
  for (const file of ["demo/server/index.ts", "demo/web/Login.tsx"]) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    // Deliberately omit SHA: neither read nor write the extraction cache.
    const result = await extractShapes(file, text);
    console.log(JSON.stringify({ file, ...result }, null, 2));
    assert.equal(result.source, "gemini");
    const expected = [{
      role: file.endsWith("index.ts") ? "producer" : "consumer",
      method: "POST",
      path: "/api/auth/login",
      requestFields: ["email", "password"],
      responseFields: ["token", "userId"],
    }];
    assert.deepEqual(signature(extractDeterministic(file, text)), expected);
    assert.deepEqual(signature(result.shapes), expected, `${file}: Gemini differs from the demo contract`);
    assert.ok(result.shapes.every((shape) =>
      [...shape.requestFields, ...shape.responseFields].every((field) => field.required)),
    `${file}: the demo's success fields must be required`);
  }
  console.log("Gemini matches the deterministic extractor for both demo files.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const key = process.env.GEMINI_API_KEY;
  console.error(key ? message.split(key).join("[redacted]") : message);
  process.exitCode = 1;
});
