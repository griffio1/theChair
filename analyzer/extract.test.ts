// Every provider request is intercepted; these regressions need no API key or database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { extractShapes } from "./extract";
import { extractDeterministic } from "./deterministic";
import { inWorkspace } from "../server/workspace-context";

const file = "demo/web/Login.tsx";
const text = readFileSync(new URL("../demo/web/Login.tsx", import.meta.url), "utf8")
  .replace("data.userId", "data.user_id");
const expected = extractDeterministic(file, text);
const shape = expected[0];

function provider(t: TestContext, response: unknown, mode = "auto", status = 200) {
  const env = { EXTRACTOR: mode, GEMINI_API_KEY: "test-key", GEMINI_MODEL: "test-model" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const warning = t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    assert.equal(new URL(String(input)).hostname, "generativelanguage.googleapis.com",
      "No database or unmocked destination is allowed in no-SHA checks");
    return Response.json(response, { status });
  });
  return { warning };
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

test("provider error bodies are not included in explicit Gemini errors", async (t) => {
  provider(t, { error: "test-key private-source-fragment" }, "gemini", 503);
  await assert.rejects(extractShapes(file, text), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 503/);
    assert.doesNotMatch(error.message, /test-key|private-source/);
    return true;
  });
});

test("invalid extraction JSON does not echo provider text in errors or fallback logs", async (t) => {
  const response = { candidates: [{ content: { parts: [{ text: "private-source-fragment test-key" }] } }] };
  const { warning } = provider(t, response, "gemini");
  await assert.rejects(extractShapes(file, text), /invalid extraction JSON/);
  process.env.EXTRACTOR = "auto";
  assert.equal((await extractShapes(file, text)).source, "deterministic");
  assert.equal(warning.mock.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(warning.mock.calls[0].arguments), /test-key|private-source/);
});

test("a malformed provider HTTP response is reported without its contents", async (t) => {
  provider(t, {}, "gemini");
  t.mock.method(globalThis, "fetch", async () => new Response("private-source-fragment test-key"));
  await assert.rejects(extractShapes(file, text), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Gemini returned an invalid response");
    return true;
  });
});

function cachedProvider(t: TestContext, mode = "auto") {
  provider(t,answer({shapes:expected}),mode);
  const env = {SUPABASE_URL:"https://cache.invalid",SUPABASE_SERVICE_KEY:"test-cache-key"};
  const previous = Object.fromEntries(Object.keys(env).map(key => [key,process.env[key]]));
  Object.assign(process.env,env);
  t.after(() => {
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const rows: {sha:string;file:string;shapes:unknown}[] = [];
  const counts = {model:0,reads:0,writes:0};
  const failures = {read:false,write:false};
  t.mock.method(globalThis,"fetch",async(input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "generativelanguage.googleapis.com") {
      counts.model++;
      return Response.json(answer({shapes:expected}));
    }
    assert.equal(url.origin,"https://cache.invalid","No real service is allowed");
    assert.equal(url.pathname,"/rest/v1/extraction_cache");
    if ((init?.method ?? "GET") === "GET") {
      counts.reads++;
      if (failures.read) return Response.json({error:"Cache read failed"},{status:503});
      assert.equal(url.searchParams.get("workspace_id"),"eq.10000000-0000-4000-8000-000000000001");
      return Response.json(rows.filter(row => row.sha === url.searchParams.get("sha")?.slice(3)
        && row.file === url.searchParams.get("file")?.slice(3)));
    }
    assert.equal(init?.method,"POST");
    counts.writes++;
    if (failures.write) return Response.json({error:"Cache write failed"},{status:503});
    const row = JSON.parse(String(init?.body));
    assert.equal(row.workspace_id,"10000000-0000-4000-8000-000000000001");
    const existing = rows.findIndex(item => item.sha === row.sha && item.file === row.file);
    if (existing < 0) rows.push(row); else rows[existing] = row;
    return Response.json([row]);
  });
  const run: typeof extractShapes = (...args) => inWorkspace("10000000-0000-4000-8000-000000000001",() => extractShapes(...args));
  return {run,rows,counts,failures};
}

test("a durable retry reuses each saved extraction without another model request or charge",async(t) => {
  const {run,counts} = cachedProvider(t);
  let charged = 0;
  const options = {requireCache:true,beforeModel:async() => { charged++; }};
  assert.equal((await run(file,text,"revision",options)).source,"gemini");
  assert.equal((await run(file,text,"revision",options)).source,"cache");
  assert.equal(charged,1);
  assert.deepEqual(counts,{model:1,reads:2,writes:1});
});

test("deterministic extraction and cached results never reserve model budget",async(t) => {
  const {run,counts} = cachedProvider(t,"deterministic");
  const options = {requireCache:true,beforeModel:async() => { assert.fail("Local extraction must not be charged"); }};
  assert.equal((await run(file,text,"revision",options)).source,"deterministic");
  assert.equal((await run(file,text,"revision",options)).source,"cache");
  assert.equal(counts.model,0);
});

test("a denied model budget propagates in auto mode without fallback or caching a substitute",async(t) => {
  const {run,counts,rows} = cachedProvider(t);
  const denied = new Error("Test quota denied");
  await assert.rejects(run(file,text,"revision",{requireCache:true,beforeModel:async() => { throw denied; }}),error => error === denied);
  assert.equal(counts.model,0);
  assert.equal(counts.writes,0);
  assert.equal(rows.length,0);
});

test("durable extraction stops on cache read or write failures while ordinary callers stay best-effort",async(t) => {
  const {run,counts,failures} = cachedProvider(t);
  let charged = 0;
  const options = {requireCache:true,beforeModel:async() => { charged++; }};
  failures.read = true;
  await assert.rejects(run(file,text,"revision",options),/503/);
  assert.equal(charged,0); assert.equal(counts.model,0);
  failures.read = false; failures.write = true;
  await assert.rejects(run(file,text,"revision",options),/503/);
  assert.equal(charged,1); assert.equal(counts.model,1);
  failures.read = true;
  assert.equal((await run(file,text,"revision")).source,"gemini","Default callers retain best-effort cache behavior");
});

test("cache identity separates legacy rows, source text, mode, model, path and commit",async(t) => {
  const {run,rows,counts} = cachedProvider(t);
  rows.push({sha:"revision",file,shapes:"invalid legacy extraction"});
  const strict = {requireCache:true};
  assert.equal((await run(file,text,"revision",strict)).source,"gemini","Commit-only legacy rows are not reused");
  assert.equal((await run(file,text,"revision",strict)).source,"cache");
  assert.equal((await run(file,`${text}\n// changed`,"revision",strict)).source,"gemini");
  assert.equal((await run("another.tsx",text,"revision",strict)).source,"gemini");
  assert.equal((await run(file,text,"another-revision",strict)).source,"gemini");
  process.env.GEMINI_MODEL = "another-test-model";
  assert.equal((await run(file,text,"revision",strict)).source,"gemini");
  process.env.EXTRACTOR = "deterministic";
  assert.equal((await run(file,text,"revision",strict)).source,"deterministic");
  assert.equal(counts.model,5);
  const keys = rows.slice(1).map(row => row.sha);
  assert.equal(new Set(keys).size,6);
  assert.ok(keys.every(key => /^extract-v2:[a-f0-9]{64}$/.test(key)));
});

test("durable checks reject a corrupt current cache and a missing revision instead of silently advancing",async(t) => {
  const {run,rows,counts} = cachedProvider(t);
  await assert.rejects(run(file,text,undefined,{requireCache:true}),/source revision/);
  assert.equal(counts.reads,0);
  await run(file,text,"revision",{requireCache:true});
  rows[0].shapes = [{...shape,evidence:null}];
  await assert.rejects(run(file,text,"revision",{requireCache:true}),/invalid HTTP shape/);
  assert.equal(counts.model,1);
});

test("auto mode without a provider key uses local extraction without charging a model call",async(t) => {
  const {run,counts} = cachedProvider(t);
  process.env.GEMINI_API_KEY = "";
  const result = await run(file,text,"revision",{requireCache:true,beforeModel:async() => { assert.fail("No model request is possible"); }});
  assert.equal(result.source,"deterministic");
  assert.equal(counts.model,0);
});
