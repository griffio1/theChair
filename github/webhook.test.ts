// Run: node --import tsx --test github/webhook.test.ts
// These integration checks intercept every HTTP request. No keys or live services are used.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { inWorkspace } from "../server/workspace-context";
import { handlePush as push, verifySignature } from "./webhook";
import { extractDeterministic } from "../analyzer/deterministic";

const team = "10000000-0000-4000-8000-000000000001";
const handlePush: typeof push = (p, options) => inWorkspace(team, () => push(p, options));
type Row = Record<string, unknown>;

const contract = JSON.parse(
  readFileSync(
    new URL("../contracts/auth-login.json", import.meta.url),
    "utf8",
  ),
);
const healthy = readFileSync(
  new URL("../demo/web/Login.tsx", import.meta.url),
  "utf8",
);
// Broken code exists only as test data, never in the demo file or on GitHub.
const broken = healthy.replace("data.userId", "data.user_id");
const payload = {
  ref: "refs/heads/agent/codex/demo-flow",
  before: "a".repeat(40),
  after: "b".repeat(40),
  pusher: { name: "carter" },
  head_commit: { message: "Check the demo login consumer" },
};

function environment(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function fixture(
  t: TestContext,
  text = broken,
  paths = ["demo/web/Login.tsx"],
) {
  environment(t, {
    EXTRACTOR: "deterministic",
    SUPABASE_URL: "https://ledger.invalid",
    SUPABASE_SERVICE_KEY: "test-key",
    GITHUB_TOKEN: "test-token",
    GITHUB_REPO: "test/thechair",
  });
  const tables: Record<string, Row[]> = {
    contracts: [{ ...structuredClone(contract), workspace_id: team }],
    chair_repository_connections: [
      {
        workspace_id: team,
        repository: "test/thechair",
        repository_id: 1,
        token: "test-token",
      },
    ],
    conflicts: [],
    messages: [],
    events: [],
    extraction_cache: [],
  };
  const requests: { method: string; url: URL }[] = [];
  const reads: string[] = [];
  const failures = new Map<string, number>();
  const models = { calls:0 };
  let nextId = 0;
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      if (url.origin === "https://generativelanguage.googleapis.com") {
        models.calls++;
        return json({candidates:[{finishReason:"STOP",content:{parts:[{
          text:JSON.stringify({shapes:extractDeterministic("fixture.tsx",text)}),
        }]}}]});
      }
      if (url.origin === "https://ledger.invalid") {
        const name = url.pathname.split("/").pop()!;
        assert.ok(Object.hasOwn(tables, name), `Unexpected table: ${name}`);
        const rows = tables[name];
        if (method === "GET") {
          const matches = rows.filter((row) =>
            [...url.searchParams].every(
              ([field, filter]) =>
                !filter.startsWith("eq.") ||
                String(row[field]) === filter.slice(3),
            ),
          );
          const limit = url.searchParams.get("limit");
          return json(limit ? matches.slice(0, Number(limit)) : matches);
        }
        assert.equal(
          method,
          "POST",
          "The push pipeline should only read and insert ledger data",
        );
        const body = JSON.parse(String(init?.body));
        const status = failures.get(name);
        if (status) {
          failures.delete(name);
          return new Response(
            JSON.stringify({ message: "Simulated write failure" }),
            { status },
          );
        }
        const incoming: Row[] = Array.isArray(body) ? body : [body];
        // Mirror Postgres primary-key enforcement rather than silently appending duplicates.
        if (
          incoming.some(
            (row) => row.id && rows.some((existing) => existing.id === row.id),
          )
        ) {
          return new Response(
            JSON.stringify({ code: "23505", message: "duplicate primary key" }),
            { status: 409 },
          );
        }
        const inserted = incoming.map((row: Row) => ({
          id: `test-${++nextId}`,
          created_at: new Date().toISOString(),
          ...row,
        }));
        rows.push(...inserted);
        return json(inserted);
      }
      if (url.origin === "https://api.github.com") {
        assert.equal(
          method,
          "GET",
          "A push check must not write repository files",
        );
        if (url.pathname.startsWith("/repos/test/thechair/git/commits/")) return json({ tree: { sha: "tree" } });
        if (url.pathname.startsWith("/repos/test/thechair/git/trees/")) return json({ truncated: false, tree: paths.map((path) => ({ path, type: "blob" })) });
        if (url.pathname.startsWith("/repos/test/thechair/compare/")) {
          return json({
            files: paths.map((filename) => ({ filename, status: "modified" })),
          });
        }
        const prefix = "/repos/test/thechair/contents/";
        assert.ok(
          url.pathname.startsWith(prefix),
          `Unexpected GitHub route: ${url.pathname}`,
        );
        const file = decodeURIComponent(url.pathname.slice(prefix.length));
        reads.push(file);
        const readFailure = failures.get(`file:${file}`);
        if (readFailure) {
          failures.delete(`file:${file}`);
          return new Response("", { status: readFailure });
        }
        assert.equal(
          url.searchParams.get("ref"),
          payload.after,
          "Read code at the pushed SHA",
        );
        assert.ok(paths.includes(file));
        return json({
          content: Buffer.from(text).toString("base64"),
          sha: "test-blob",
        });
      }
      assert.fail(`Unmocked network destination blocked: ${url.origin}`);
    },
  );
  return {
    tables,
    requests,
    reads,
    models,
    failNext: (table: string, status: number) => failures.set(table, status),
  };
}

test("a pushed mismatch creates one blocking conflict and its dashboard card", async (t) => {
  assert.notEqual(
    broken,
    healthy,
    "The demo fixture must contain the intended mismatch",
  );
  const { tables } = fixture(t);
  const result = await handlePush(payload);
  assert.equal(result.length, 1);
  const conflict = result[0];
  assert.equal(conflict.kind, "field_mismatch");
  assert.equal(conflict.severity, "block");
  assert.equal(conflict.contractId, "auth-login");
  assert.equal(conflict.detectedBy, "webhook");
  assert.equal(conflict.agent, "codex");
  assert.equal(conflict.developer, "carter");
  assert.equal(conflict.status, "open");
  assert.ok(
    conflict.evidence?.some(
      (e) =>
        e.file === "demo/web/Login.tsx" &&
        e.line > 0 &&
        e.snippet.includes("data.user_id"),
    ),
  );
  assert.equal(tables.conflicts.length, 1);
  assert.equal(tables.messages.length, 1);
  assert.equal(tables.messages[0].kind, "conflict");
  assert.equal(tables.messages[0].ref_id, conflict.id);
  assert.match(String(tables.messages[0].body), /user_id.*userId/);
});

test("a compliant pushed consumer reports the detected API coverage without conflicts", async (t) => {
  const { tables } = fixture(t, healthy);
  assert.deepEqual(await handlePush(payload), []);
  assert.equal(tables.conflicts.length, 0);
  assert.equal(tables.messages.length, 1);
  assert.equal(tables.messages[0].kind, "event");
  assert.match(String(tables.messages[0].body), /Checked 1 API\(s\) in 1 file\(s\)/);
  assert.match(String(tables.messages[0].body), /No mismatches found in the detected API code/);
});

test("generated contract files do not trigger source analysis or announcements", async (t) => {
  const { reads, tables } = fixture(t, healthy, ["contracts/auth-login.json", "AGENTS.md"]);
  for (const message of [
    "AGENTS.md: sync contracts",
    "contracts: auth-login v1",
  ]) {
    assert.deepEqual(
      await handlePush({ ...payload, head_commit: { message } }),
      [],
    );
  }
  assert.deepEqual(reads, []);
  assert.equal(tables.conflicts.length, 0);
  assert.equal(tables.messages.length, 0);
});

test("a sync-looking commit title cannot bypass checks of changed application code", async (t) => {
  fixture(t);
  for (const message of ["contracts: fix login", "AGENTS.md: sync contracts and change login"]) {
    const conflicts = await handlePush({ ...payload, head_commit: { message } });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, "field_mismatch");
  }
});

test("an unsupported source file reports missing coverage instead of a clean result", async (t) => {
  const { tables } = fixture(t, "export const request = apiClient.login({ email, password });");
  assert.deepEqual(await handlePush(payload), []);
  assert.equal(tables.messages.length, 1);
  assert.match(String(tables.messages[0].body), /No API code recognized/);
  assert.doesNotMatch(String(tables.messages[0].body), /All clear|No mismatches/);
});

test("an unreadable changed file cannot produce a clean result and can be retried", async (t) => {
  const { tables, failNext } = fixture(t, healthy);
  failNext("file:demo/web/Login.tsx", 404);
  await assert.rejects(handlePush(payload), /source file could not be read/);
  assert.equal(tables.messages.length, 0);
  await handlePush(payload);
  assert.equal(tables.events.length, 1);
  assert.equal(tables.messages.length, 1);
});

test("a new branch checks the complete recursive snapshot at its head commit", async (t) => {
  const { requests } = fixture(t);
  const conflicts = await handlePush({ ...payload, before: "0".repeat(40) });
  assert.equal(conflicts[0].kind, "field_mismatch");
  assert.ok(requests.some((request) => request.url.pathname === `/repos/test/thechair/git/commits/${payload.after}`));
  assert.ok(requests.some((request) => request.url.pathname === "/repos/test/thechair/git/trees/tree" && request.url.searchParams.get("recursive") === "1"));
  assert.ok(!requests.some((request) => request.url.pathname.includes("/compare/")));
});

test("non-code files, generated files and tests are excluded from analysis", async (t) => {
  const { reads, tables } = fixture(t, healthy, [
    "README.md",
    "contracts/auth-login.json",
    "node_modules/dependency.ts",
    ".next/generated.ts",
    "dist/bundle.js",
    "build/output.js",
    "web/app/page.tsx",
    "server/chat.ts",
    "engine/diff.ts",
    "mcp/server.ts",
    "hooks/preflight.ts",
    "github/webhook.ts",
    "analyzer/extract.ts",
    "shared/types.ts",
    "demo/web/Login.test.tsx",
    "demo/web/Login.tsx",
  ]);
  await handlePush(payload);
  assert.deepEqual(reads, ["demo/web/Login.tsx"]);
  assert.match(String(tables.messages[0].body), /Checked 1 API\(s\) in 1 file/);
});

test("webhook signatures reject missing, modified and malformed signatures", (t) => {
  const secret = "isolated-signature-secret";
  environment(t, { GITHUB_WEBHOOK_SECRET: secret });
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifySignature(body, signature), true);
  assert.equal(verifySignature(`${body} `, signature), false);
  assert.equal(verifySignature(body, null), false);
  assert.equal(verifySignature(body, "sha256=bad"), false);
});

test("webhooks fail closed when a signing secret is not configured", (t) => {
  environment(t, { GITHUB_WEBHOOK_SECRET: "" });
  assert.equal(verifySignature("{}", null), false);
  assert.equal(verifySignature("{}", "sha256=anything"), false);
});

test("re-delivering a push does not duplicate a conflict or its dashboard card", async (t) => {
  const { tables } = fixture(t);
  const first = await handlePush(payload);
  const second = await handlePush(payload);
  assert.equal(first[0].id, second[0].id);
  assert.equal(tables.events.length, 1);
  assert.equal(tables.conflicts.length, 1);
  assert.equal(tables.messages.filter((m) => m.kind === "conflict").length, 1);
});

test("concurrent deliveries create one event, conflict and dashboard card", async (t) => {
  const { tables } = fixture(t);
  const results = await Promise.all([
    handlePush(payload),
    handlePush(payload),
    handlePush(payload),
  ]);
  assert.ok(results.every((rows) => rows[0].id === results[0][0].id));
  assert.equal(tables.events.length, 1);
  assert.equal(tables.conflicts.length, 1);
  assert.equal(tables.messages.length, 1);
});

test("a replay preserves an approved conflict instead of reopening it", async (t) => {
  const { tables } = fixture(t);
  await handlePush(payload);
  tables.conflicts[0].status = "approved";
  const replay = await handlePush(payload);
  assert.equal(replay[0].status, "approved");
  assert.equal(tables.conflicts[0].status, "approved");
  assert.equal(tables.messages.length, 1);
});

test("a retry recovers an announcement that failed after saving the conflict", async (t) => {
  const { tables, failNext } = fixture(t);
  failNext("messages", 503);
  await assert.rejects(handlePush(payload), /messages -> 503:/);
  assert.equal(tables.conflicts.length, 1);
  assert.equal(tables.messages.length, 0);
  await handlePush(payload);
  assert.equal(tables.events.length, 1);
  assert.equal(tables.conflicts.length, 1);
  assert.equal(tables.messages.length, 1);
  assert.equal(tables.messages[0].ref_id, tables.conflicts[0].id);
});

test("conflict storage failures propagate and a retry can finish the check", async (t) => {
  const { tables, failNext } = fixture(t);
  failNext("conflicts", 503);
  await assert.rejects(handlePush(payload), /conflicts -> 503:/);
  assert.equal(tables.messages.length, 0);
  await handlePush(payload);
  assert.equal(tables.conflicts.length, 1);
  assert.equal(tables.messages.length, 1);
});

test("a 409 without the expected row is not mistaken for a successful replay", async (t) => {
  const { tables, failNext } = fixture(t);
  failNext("events", 409);
  await assert.rejects(handlePush(payload), /events -> 409:/);
  assert.equal(tables.conflicts.length, 0);
});

test("re-delivering a clean push does not duplicate the all-clear event", async (t) => {
  const { tables } = fixture(t, healthy);
  await Promise.all([handlePush(payload), handlePush(payload)]);
  assert.equal(tables.events.length, 1);
  assert.equal(tables.messages.length, 1);
  assert.equal(tables.messages[0].kind, "event");
});

test("the same snapshot pushed to another branch remains a separate check", async (t) => {
  const { tables } = fixture(t);
  await handlePush(payload);
  await handlePush({ ...payload, ref: "refs/heads/agent/codex/another-demo" });
  assert.equal(tables.events.length, 2);
  assert.equal(tables.conflicts.length, 2);
  assert.equal(tables.messages.length, 2);
});

test("connected projects analyze web and server source outside theChair's own repository", async (t) => {
  fixture(t, broken, ["web/Login.tsx"]);
  environment(t, { GITHUB_REPO: "different/thechair-source" });
  const conflicts = await handlePush(payload);
  assert.ok(conflicts.some((c) => c.kind === "field_mismatch"));
});

test("a queued push beyond one extraction quota window resumes without charging saved files again",async(t) => {
  const paths = Array.from({length:61},(_,index) => `demo/consumer-${index}.tsx`);
  const {tables,models} = fixture(t,broken,paths);
  environment(t,{EXTRACTOR:"auto",GEMINI_API_KEY:"test-model-key",GEMINI_MODEL:"test-model"});
  let used = 0, charged = 0;
  const quota = new Error("Test quota window exhausted");
  const beforeExtract = async() => {
    if (used >= 60) throw quota;
    used++; charged++;
  };
  await assert.rejects(handlePush(payload,{beforeExtract}),error => error === quota);
  assert.equal(tables.extraction_cache.length,60);
  assert.equal(tables.messages.length,0,"An unfinished push does not announce a clean result");
  used = 0;
  const result = await handlePush(payload,{beforeExtract});
  assert.equal(result.length,61);
  assert.equal(charged,61,"Only the final uncached file uses the new quota window");
  assert.equal(models.calls,61);
  assert.equal(tables.extraction_cache.length,61);
  assert.equal(tables.events.length,1);
});

test("queued local extraction never calls the model budget and cache write failure stops before the next file",async(t) => {
  const {tables,reads,failNext} = fixture(t,healthy,["demo/one.tsx","demo/two.tsx"]);
  const beforeExtract = async() => { assert.fail("Local extraction must not reserve model budget"); };
  failNext("extraction_cache",503);
  await assert.rejects(handlePush(payload,{beforeExtract}),/extraction_cache -> 503/);
  assert.deepEqual(reads,["demo/one.tsx"]);
  assert.equal(tables.messages.length,0);
  await handlePush(payload,{beforeExtract});
  assert.equal(tables.messages.length,1);
  assert.equal(tables.extraction_cache.length,2);
});
