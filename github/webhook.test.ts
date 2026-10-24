// Run: node --import tsx --test github/webhook.test.ts
// These integration checks intercept every HTTP request. No keys or live services are used.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { handlePush, verifySignature } from "./webhook";

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
    contracts: [structuredClone(contract)],
    conflicts: [],
    messages: [],
    events: [],
    extraction_cache: [],
  };
  const requests: { method: string; url: URL }[] = [];
  const reads: string[] = [];
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
        const inserted = (Array.isArray(body) ? body : [body]).map(
          (row: Row) => ({
            id: `test-${++nextId}`,
            created_at: new Date().toISOString(),
            ...row,
          }),
        );
        rows.push(...inserted);
        return json(inserted);
      }
      if (url.origin === "https://api.github.com") {
        assert.equal(
          method,
          "GET",
          "A push check must not write repository files",
        );
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
        assert.equal(
          url.searchParams.get("ref"),
          payload.after,
          "Read code at the pushed SHA",
        );
        assert.equal(file, "demo/web/Login.tsx");
        return json({
          content: Buffer.from(text).toString("base64"),
          sha: "test-blob",
        });
      }
      assert.fail(`Unmocked network destination blocked: ${url.origin}`);
    },
  );
  return { tables, requests, reads };
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

test("a compliant pushed consumer produces an all-clear message without conflicts", async (t) => {
  const { tables } = fixture(t, healthy);
  assert.deepEqual(await handlePush(payload), []);
  assert.equal(tables.conflicts.length, 0);
  assert.equal(tables.messages.length, 1);
  assert.equal(tables.messages[0].kind, "event");
  assert.match(String(tables.messages[0].body), /All clear/);
});

test("generated contract commits do not trigger analysis or announcements", async (t) => {
  const { requests } = fixture(t);
  for (const message of [
    "AGENTS.md: sync contracts",
    "contracts: auth-login v1",
  ]) {
    assert.deepEqual(
      await handlePush({ ...payload, head_commit: { message } }),
      [],
    );
  }
  assert.equal(requests.length, 0);
});

test("non-code files, generated files and tests are excluded from analysis", async (t) => {
  const { reads, tables } = fixture(t, healthy, [
    "README.md",
    "contracts/auth-login.json",
    "node_modules/dependency.ts",
    ".next/generated.ts",
    "dist/bundle.js",
    "build/output.js",
    "demo/web/Login.test.tsx",
    "demo/web/Login.tsx",
  ]);
  await handlePush(payload);
  assert.deepEqual(reads, ["demo/web/Login.tsx"]);
  assert.match(String(tables.messages[0].body), /Checked 1 file/);
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

test(
  "re-delivering a push does not duplicate a conflict or its dashboard card",
  {
    skip: "Waiting for Parag's active webhook change before implementing delivery deduplication",
  },
  async (t) => {
    const { tables } = fixture(t);
    await handlePush(payload);
    await handlePush(payload);
    assert.equal(tables.conflicts.length, 1);
    assert.equal(
      tables.messages.filter((m) => m.kind === "conflict").length,
      1,
    );
  },
);
