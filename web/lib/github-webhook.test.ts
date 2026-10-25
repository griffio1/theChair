import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readWebhookBody } from "./github-webhook";
import { WorkspaceError } from "./workspace-server";
import { POST } from "../app/api/github/webhook/route";

test("webhook limits actual UTF-8 bytes and cancels oversized streams", async () => {
  const body = '{"text":"hello 🌍"}';
  assert.equal(await readWebhookBody(new Request("http://localhost", { method: "POST", body })), body);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(700_000)); },
    cancel() { cancelled = true; },
  });
  const req = new Request("http://localhost", {
    method: "POST", headers: { "content-length": "1" }, body: stream, duplex: "half",
  } as RequestInit);
  await assert.rejects(readWebhookBody(req),
    (error: unknown) => error instanceof WorkspaceError && error.status === 413);
  assert.equal(cancelled, true);
  const multibyte = new Request("http://localhost", { method: "POST", body: "é".repeat(1_000_001) });
  await assert.rejects(readWebhookBody(multibyte),
    (error: unknown) => error instanceof WorkspaceError && error.status === 413);
});

test("webhook rejects invalid input and reports unavailable configuration safely", async (t) => {
  const previousUrl = process.env.SUPABASE_URL;
  delete process.env.SUPABASE_URL;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
  });
  const req = (body: string) => new Request("http://localhost/api/github/webhook", { method: "POST", body });
  assert.equal((await POST(req("{"))).status, 400);
  assert.equal((await POST(req('{"repository":{}}'))).status, 400);
  assert.equal((await POST(req("x".repeat(2_000_001)))).status, 413);
  const unavailable = await POST(req('{"repository":{"id":42}}'));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "Webhook storage unavailable" });
});

test("webhook authenticates the raw payload against the matching repository secret", async (t) => {
  const vars = { SUPABASE_URL: "https://database.invalid", SUPABASE_SERVICE_KEY: "test-service-key" };
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const secret = "test-webhook-secret";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.ok(url.pathname.endsWith("chair_repository_connections"));
    return Response.json(url.searchParams.get("repository_id") === "eq.42" ? [{
      workspace_id: "10000000-0000-4000-8000-000000000001",
      webhook_secret: secret, repository: "owner/repo",
    }] : []);
  });
  const request = (payload: object, signature?: string, event = "ping") => {
    const body = JSON.stringify(payload);
    return new Request("http://localhost/api/github/webhook", {
      method: "POST", body,
      headers: {
        "x-github-event": event,
        "x-hub-signature-256": signature ?? `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
      },
    });
  };
  assert.equal((await POST(request({ repository: { id: 42 } }, "sha256=bad"))).status, 401);
  assert.equal((await POST(request({ repository: { id: 43 } }))).status, 401);
  const ping = await POST(request({ repository: { id: 42 } }));
  assert.equal(ping.status, 200);
  assert.deepEqual(await ping.json(), { ok: true });
  assert.equal((await POST(request({ repository: { id: 42 } }, undefined, "push"))).status, 400);
  const ignored = await POST(request({ repository: { id: 42 } }, undefined, "issues"));
  assert.equal(ignored.status, 202);
  assert.deepEqual(await ignored.json(), { ignored: "issues" });
});
