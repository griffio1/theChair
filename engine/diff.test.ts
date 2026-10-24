import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Claim, Contract, ExtractedShape, FieldSpec } from "../shared/types";
import { diffShape, normalizePath } from "./diff";
import { preflight } from "./preflight";
import { updateAgentsMd } from "./agentsmd";

const here = dirname(fileURLToPath(import.meta.url));
const login: Contract = JSON.parse(readFileSync(join(here, "../contracts/auth-login.json"), "utf8"));
const contracts = [login];

const s = (name: string, type: FieldSpec["type"] = "string"): FieldSpec => ({ name, type, required: true });

function shape(p: Partial<ExtractedShape>): ExtractedShape {
  return {
    file: "demo/server/auth.ts",
    role: "producer",
    method: "POST",
    path: "/api/auth/login",
    responseFields: [s("userId"), s("token")],
    requestFields: [s("email"), s("password")],
    evidence: [{ line: 12, snippet: "res.json({ userId, token })" }],
    ...p,
  };
}

test("matching producer is clean", () => {
  assert.deepEqual(diffShape(shape({}), contracts), []);
});

test("matching consumer is clean", () => {
  const c = shape({ role: "consumer", file: "demo/web/Login.tsx", responseFields: [s("userId")] });
  assert.deepEqual(diffShape(c, contracts), []);
});

test("demo beat: backend renames userId to user_id -> block field_mismatch", () => {
  const out = diffShape(shape({ responseFields: [s("user_id"), s("token")] }), contracts);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "field_mismatch");
  assert.equal(out[0].severity, "block");
  assert.match(out[0].suggestedFix!, /Rename `user_id` to `userId`/);
});

test("demo beat: frontend reads user_id -> block field_mismatch", () => {
  const c = shape({ role: "consumer", file: "demo/web/Login.tsx", responseFields: [s("user_id")] });
  const out = diffShape(c, contracts);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "field_mismatch");
  assert.equal(out[0].severity, "block");
});

test("field conflict leads with the evidence line that mentions the field", () => {
  const c = shape({
    role: "consumer",
    file: "demo/web/Login.tsx",
    responseFields: [s("user_id")],
    evidence: [
      { line: 11, snippet: 'const res = await fetch("/api/auth/login", {' },
      { line: 17, snippet: 'localStorage.setItem("token", data.token);' },
      { line: 18, snippet: "setGreeting(`Welcome, user #${data.user_id}`);" },
    ],
  });
  const out = diffShape(c, contracts);
  assert.deepEqual(
    out[0].evidence.map((e) => e.line),
    [18, 11, 17],
  );
});

test("producer missing token -> block missing_field", () => {
  const out = diffShape(shape({ responseFields: [s("userId")] }), contracts);
  assert.equal(out[0].kind, "missing_field");
  assert.equal(out[0].severity, "block");
});

test("producer extra field -> warn only", () => {
  const out = diffShape(shape({ responseFields: [s("userId"), s("token"), s("avatar")] }), contracts);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "extra_field");
  assert.equal(out[0].severity, "warn");
});

test("consumer reads a field nobody sends -> block", () => {
  const c = shape({ role: "consumer", responseFields: [s("displayName")] });
  const out = diffShape(c, contracts);
  assert.equal(out[0].kind, "extra_field");
  assert.equal(out[0].severity, "block");
});

test("type mismatch -> block", () => {
  const out = diffShape(shape({ responseFields: [s("userId", "number"), s("token")] }), contracts);
  assert.equal(out[0].kind, "type_mismatch");
});

test("wrong method on a contracted path -> block route_mismatch", () => {
  const out = diffShape(shape({ method: "GET" }), contracts);
  assert.equal(out[0].kind, "route_mismatch");
  assert.equal(out[0].severity, "block");
});

test("uncontracted route -> warn", () => {
  const out = diffShape(shape({ path: "/api/profile" }), contracts);
  assert.equal(out[0].severity, "warn");
});

test("path normalization handles params, query, host, trailing slash", () => {
  assert.equal(normalizePath("http://localhost:3000/api/users/${id}/?x=1"), "/api/users/:param");
  assert.equal(normalizePath("/api/users/:userId"), "/api/users/:param");
  assert.equal(normalizePath("/api/users/{id}"), "/api/users/:param");
});

test("preflight: block verdict with suggestion", () => {
  const r = preflight(
    {
      agent: "codex",
      developer: "b",
      intent: "build login screen",
      paths: ["demo/web/Login.tsx"],
      shapes: [shape({ role: "consumer", file: "demo/web/Login.tsx", responseFields: [s("user_id")] })],
    },
    contracts,
    [],
  );
  assert.equal(r.verdict, "block");
  assert.match(r.suggestion!, /userId/);
  assert.equal(r.conflicts[0].agent, "codex");
});

test("preflight: other developer's live claim -> warn", () => {
  const claim: Claim = {
    id: "c1",
    agent: "claude-code",
    developer: "a",
    paths: ["demo/server"],
    intent: "auth backend",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const r = preflight(
    { agent: "codex", developer: "b", intent: "tweak", paths: ["demo/server/auth.ts"] },
    contracts,
    [claim],
  );
  assert.equal(r.verdict, "warn");
  assert.equal(r.conflicts[0].kind, "path_overlap");
});

test("preflight: own claim and expired claims are ignored", () => {
  const mk = (developer: string, ms: number): Claim => ({
    id: developer,
    agent: "codex",
    developer,
    paths: ["demo/server/auth.ts"],
    intent: "x",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ms).toISOString(),
  });
  const r = preflight(
    { agent: "codex", developer: "b", intent: "x", paths: ["demo/server/auth.ts"] },
    contracts,
    [mk("b", 60_000), mk("a", -1000)],
  );
  assert.equal(r.verdict, "ok");
});

test("AGENTS.md contract section is rewritten in place", () => {
  const md = "# Rules\n\n<!-- THECHAIR:CONTRACTS:START -->\nold\n<!-- THECHAIR:CONTRACTS:END -->\n\nfooter\n";
  const v2: Contract = { ...login, version: 2, response: [s("user_id"), s("token")] };
  const out = updateAgentsMd(md, [v2]);
  assert.match(out, /auth-login v2/);
  assert.match(out, /user_id: string/);
  assert.doesNotMatch(out, /\nold\n/);
  assert.match(out, /footer/);
});
