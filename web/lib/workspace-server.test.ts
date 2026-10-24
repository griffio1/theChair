import test from "node:test";
import assert from "node:assert/strict";
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
});
