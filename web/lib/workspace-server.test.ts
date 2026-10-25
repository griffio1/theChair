import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalError } from "../../server/approve";
import { ProposalInputError } from "../../server/propose";
import {
  authenticate,
  readBody,
  respond,
  textField,
  validId,
  WorkspaceError,
} from "./workspace-server";

test("workspace routes reject missing or malformed sessions before database access", async () => {
  for (const authorization of [
    "",
    "Basic credentials",
    "Bearer ",
    "Bearer token extra",
  ]) {
    await assert.rejects(
      authenticate(
        new Request("http://localhost/api/workspaces", {
          headers: { authorization },
        }),
      ),
      (e: unknown) => e instanceof WorkspaceError && e.status === 401,
    );
  }
});

test("temporary auth failures preserve sessions while invalid tokens still return 401", async (t) => {
  const vars = {
    NEXT_PUBLIC_SUPABASE_URL: "https://database.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test",
  };
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let status = 200;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(new URL(String(input)).pathname, "/auth/v1/user");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer session");
    if (!status) throw new DOMException("Timed out", "TimeoutError");
    return Response.json(status === 200 ? {
      id: "30000000-0000-4000-8000-000000000003",
      aud: "authenticated", app_metadata: {}, user_metadata: {},
    } : { message: "Auth provider error" }, { status });
  });
  const req = () => new Request("http://localhost/api/workspaces", {
    headers: { authorization: "Bearer session" },
  });
  assert.equal((await authenticate(req())).userId, "30000000-0000-4000-8000-000000000003");
  for (status of [0, 429, 500, 502, 503]) {
    const response = await respond(() => authenticate(req()));
    assert.equal(response.status, 503, `upstream ${status} must not force sign-in`);
    assert.match((await response.json()).error, /Can't check your sign-in right now/);
  }
  for (status of [400, 401, 403]) {
    await assert.rejects(authenticate(req()),
      (error: unknown) => error instanceof WorkspaceError && error.status === 401);
  }
});
test("JSON parsing bounds actual content and rejects invalid bodies", async () => {
  const req = (body: string) =>
    new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  assert.deepEqual(await readBody(req('{"name":"Team"}')), { name: "Team" });
  for (const body of ["null", "[]", "{", '"text"'])
    await assert.rejects(readBody(req(body)), WorkspaceError);
  await assert.rejects(
    readBody(req(JSON.stringify({ body: "a".repeat(65536) }))),
    (e: unknown) => e instanceof WorkspaceError && e.status === 413,
  );
});
test("input validation prevents invalid IDs and blank or oversized text", () => {
  assert.equal(
    validId("10000000-0000-4000-8000-000000000001"),
    "10000000-0000-4000-8000-000000000001",
  );
  for (const value of ["../other", "or(id.eq.anything)", ""])
    assert.throws(() => validId(value), WorkspaceError);
  for (const value of ["", "   ", 17, "x".repeat(81)])
    assert.throws(() => textField({ name: value }, "name", 80), WorkspaceError);
  assert.equal(textField({ name: " Team " }, "name", 80), "Team");
});
test("response errors hide backend details and forbid shared caching", async () => {
  const r = await respond(async () => {
    throw new Error("secret database error");
  });
  assert.equal(r.status, 500);
  assert.equal(r.headers.get("cache-control"), "no-store, private");
  assert.equal(r.headers.get("vary"), "Authorization");
  assert.doesNotMatch(await r.text(), /secret database/);
  const denied = await respond(async () => {
    throw new WorkspaceError(403, "Denied");
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: "Denied" });
  for (const status of [409,404,503]) {
    const approval = await respond(async () => { throw new ApprovalError(status,"Approval needs review."); });
    assert.equal(approval.status,status);
    assert.deepEqual(await approval.json(),{error:"Approval needs review."});
  }
  const proposal = await respond(async () => { throw new ProposalInputError("Check the agreement fields."); });
  assert.equal(proposal.status,400);
  assert.deepEqual(await proposal.json(),{error:"Check the agreement fields."});
});
