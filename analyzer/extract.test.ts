// Every provider request is intercepted; these regressions need no API key or database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { extractShapes } from "./extract";
import { extractDeterministic } from "./deterministic";

const file = "demo/web/Login.tsx";
const text = readFileSync(new URL("../demo/web/Login.tsx", import.meta.url), "utf8")
  .replace("data.userId", "data.user_id");
const expected = extractDeterministic(file, text);
const shape = expected[0];

function provider(t: TestContext, response: unknown, mode = "auto") {
  const env = { EXTRACTOR: mode, GEMINI_API_KEY: "test-key", GEMINI_MODEL: "test-model" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    assert.equal(new URL(String(input)).hostname, "generativelanguage.googleapis.com",
      "No database or unmocked destination is allowed in no-SHA checks");
    return Response.json(response);
  });
}

const answer = (value: unknown) => ({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }],
});

test("automatic extraction falls back when Gemini blocks or omits its answer", async (t) => {
  for (const [name, response] of [
    ["safety block", { promptFeedback: { blockReason: "SAFETY" } }],
    ["missing text", { candidates: [{ content: { parts: [] } }] }],
    ["blank text", { candidates: [{ content: { parts: [{ text: "  " }] } }] }],
  ] as const) {
    await t.test(name, async (t) => {
      provider(t, response);
      const result = await extractShapes(file, text);
      assert.equal(result.source, "deterministic");
      assert.deepEqual(result.shapes, expected);
      assert.ok(result.shapes[0].responseFields.some((field) => field.name === "user_id"));
    });
  }
});

test("explicit Gemini mode reports missing output instead of accepting an empty analysis", async (t) => {
  provider(t, {}, "gemini");
  await assert.rejects(extractShapes(file, text), /no extraction text/);
});

test("a valid empty extraction is accepted for code without HTTP calls", async (t) => {
  provider(t, answer({ shapes: [] }));
  assert.deepEqual(await extractShapes("component.ts", "export const title = 'Hello';"),
    { source: "gemini", shapes: [] });
});

test("malformed Gemini shapes fall back before reaching the diff engine", async (t) => {
  for (const [name, value] of [
    ["missing shape list", {}],
    ["null shape list", { shapes: null }],
    ["invalid role", { shapes: [{ ...shape, role: "other" }] }],
    ["invalid method", { shapes: [{ ...shape, method: "INVALID" }] }],
    ["invalid path", { shapes: [{ ...shape, path: "not-a-path" }] }],
    ["invalid field type", { shapes: [{ ...shape, requestFields: [{ name: "email", type: "invalid", required: true }] }] }],
    ["invalid field record", { shapes: [{ ...shape, responseFields: [{ name: "", type: "string", required: "yes" }] }] }],
    ["invalid evidence", { shapes: [{ ...shape, evidence: [{ line: 0, snippet: "bad line" }] }] }],
  ] as const) {
    await t.test(name, async (t) => {
      provider(t, answer(value));
      assert.deepEqual(await extractShapes(file, text), { source: "deterministic", shapes: expected });
    });
  }
});

test("unfinished output cannot certify a clean extraction even if its JSON parses", async (t) => {
  const response = answer({ shapes: [] });
  response.candidates[0].finishReason = "MAX_TOKENS";
  provider(t, response);
  assert.deepEqual(await extractShapes(file, text), { source: "deterministic", shapes: expected });
});

test("valid Gemini text parts are joined, thoughts ignored, and the source filename preserved", async (t) => {
  const json = JSON.stringify({ shapes: [{ ...shape, file: "untrusted-file.ts" }] });
  provider(t, {
    candidates: [{ finishReason: "STOP", content: { parts: [
      { thought: true, text: "An internal summary" },
      { text: json.slice(0, 20) },
      { text: json.slice(20) },
    ] } }],
  });
  assert.deepEqual(await extractShapes(file, text), { source: "gemini", shapes: expected });
});
