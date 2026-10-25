import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Contract } from "../shared/types";
import { extractDeterministic, objectKeys } from "./deterministic";
import { diffShapes } from "../engine/diff";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const contracts: Contract[] = [JSON.parse(read("contracts/auth-login.json"))];
const names = (fs: { name: string }[]) => fs.map((f) => f.name).sort();

test("objectKeys handles shorthand, values, nesting, spreads", () => {
  assert.deepEqual(objectKeys(" userId: user.id, token, meta: { a: 1, b: 2 }, ...rest "), ["userId", "token", "meta"]);
});

test("extracts the demo backend as a producer", () => {
  const [s] = extractDeterministic("demo/server/index.ts", read("demo/server/index.ts"));
  assert.equal(s.role, "producer");
  assert.equal(s.method, "POST");
  assert.equal(s.path, "/api/auth/login");
  assert.deepEqual(names(s.requestFields), ["email", "password"]);
  // the 401 error branch is ignored; success branch has userId + token
  assert.deepEqual(names(s.responseFields), ["token", "userId"]);
});

test("extracts the demo login screen as a consumer", () => {
  const [s] = extractDeterministic("demo/web/Login.tsx", read("demo/web/Login.tsx"));
  assert.equal(s.role, "consumer");
  assert.equal(s.method, "POST");
  assert.deepEqual(names(s.requestFields), ["email", "password"]);
  assert.deepEqual(names(s.responseFields), ["token", "userId"]);
});

test("demo app as written is clean", () => {
  const shapes = [
    ...extractDeterministic("demo/server/index.ts", read("demo/server/index.ts")),
    ...extractDeterministic("demo/web/Login.tsx", read("demo/web/Login.tsx")),
  ];
  const out = diffShapes(shapes, contracts);
  assert.deepEqual(out, []);
});

test("adjacent fetches keep their own methods, request fields and response reads", () => {
  const source = `async function profile() {
    const res = await fetch('/api/profile');
    const data = await res.json();
    return data.name;
  }
  async function login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    return data.user_id;
  }`;
  const [profile, login] = extractDeterministic("client.ts", source);
  assert.equal(profile.method, "GET");
  assert.deepEqual(names(profile.requestFields), []);
  assert.deepEqual(names(profile.responseFields), ["name"]);
  assert.equal(login.method, "POST");
  assert.deepEqual(names(login.requestFields), ["email", "password"]);
  assert.deepEqual(names(login.responseFields), ["user_id"]);
  assert.ok(login.evidence.some((entry) => entry.snippet === "return data.user_id;"));
});

test("a later non-API fetch also ends the preceding response window", () => {
  const [shape] = extractDeterministic("client.ts", `async function profile() {
    const res = await fetch('/api/profile');
    const data = await res.json();
    console.log(data.name);
    const other = await fetch('/health', {method: 'POST', body: JSON.stringify({status: true})});
    const health = await other.json();
    console.log(health.status);
  }`);
  assert.equal(shape.method, "GET");
  assert.deepEqual(names(shape.requestFields), []);
  assert.deepEqual(names(shape.responseFields), ["name"]);
});

test("unrelated options and JSON serialization after a fetch are not request fields", () => {
  const [shape] = extractDeterministic("client.ts", `async function profile() {
    const res = await fetch('/api/profile', {headers: {accept: 'application/json'}});
    const data = await res.json();
    const later = {method: 'DELETE', body: JSON.stringify({unrelated: data.name})};
    return later;
  }`);
  assert.equal(shape.method, "GET");
  assert.deepEqual(names(shape.requestFields), []);
  assert.deepEqual(names(shape.responseFields), ["name"]);
});

test("demo beat 2: backend switched to snake_case is caught with a line number", () => {
  const broken = read("demo/server/index.ts").replace("res.json({ userId: user.id, token })", "res.json({ user_id: user.id, token })");
  const out = diffShapes(extractDeterministic("demo/server/index.ts", broken), contracts);
  const hit = out.find((c) => c.kind === "field_mismatch");
  assert.ok(hit, JSON.stringify(out, null, 1));
  assert.equal(hit!.severity, "block");
  assert.ok(hit!.evidence!.some((e) => e.snippet.includes("user_id")));
});
