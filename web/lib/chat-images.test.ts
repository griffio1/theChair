import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { readImage, uploadImage } from "./chat-images";
import { WorkspaceError } from "./workspace-server";

const workspace = "10000000-0000-4000-8000-000000000001";
const user = "20000000-0000-4000-8000-000000000002";
const oldId = "30000000-0000-4000-8000-000000000003";
const oldPath = `${workspace}/${user}/${oldId}.webp`;
function configure(t: TestContext) {
  const vars = {
    NEXT_PUBLIC_SUPABASE_URL: "https://database.invalid",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-public-key",
    SUPABASE_URL: "https://database.invalid",
    SUPABASE_SERVICE_KEY: "test-service-key",
  };
  Object.assign(process.env, vars);
  t.after(() => { for (const key of Object.keys(vars)) delete process.env[key]; });
}
const signedInUser = () => Response.json({ id: user, aud: "authenticated", app_metadata: {}, user_metadata: {} });

test("expired image cleanup retains its path on storage failure and retries before deleting metadata", async t => {
  configure(t);
  let retained = true, ready = true, storageFails = true, removedObject = false;
  let deletes = 0, removals = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/auth/v1/user") return signedInUser();
    if (url.pathname.endsWith("chair_memberships")) return Response.json([{ user_id: user }]);
    if (url.pathname.endsWith("chair_chat_images")) {
      if (method === "GET") {
        assert.equal(url.searchParams.get("workspace_id"), `eq.${workspace}`);
        assert.equal(url.searchParams.get("uploaded_by"), `eq.${user}`);
        assert.equal(url.searchParams.get("message_id"), "is.null");
        assert.equal(url.searchParams.get("team_message_id"), "is.null");
        assert.match(url.searchParams.get("created_at")!, /^lt\./);
        return Response.json(retained ? [{ id: oldId, object_path: oldPath }] : []);
      }
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === "PATCH" && body.ready === false) {
        assert.equal(url.searchParams.get("message_id"), "is.null");
        assert.equal(url.searchParams.get("team_message_id"), "is.null");
        ready = false;
        return Response.json(retained ? [{ id: oldId, object_path: oldPath }] : []);
      }
      if (method === "DELETE") {
        assert.equal(removedObject, true, "storage must confirm removal first");
        assert.equal(url.searchParams.get("ready"), "eq.false");
        assert.equal(url.searchParams.get("message_id"), "is.null");
        assert.equal(url.searchParams.get("team_message_id"), "is.null");
        retained = false; deletes++;
        return Response.json([]);
      }
      if (method === "POST") return Response.json({ ...body, ready: false });
      if (method === "PATCH" && body.ready === true) return Response.json([]);
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      if (method === "DELETE") {
        removals++;
        assert.equal(ready, false, "retired images must not be attachable during cleanup");
        assert.deepEqual(JSON.parse(String(init?.body)).prefixes, [oldPath]);
        if (storageFails) return Response.json({ statusCode: "503", message: "Unavailable" }, { status: 503 });
        removedObject = true;
        return Response.json([{ name: oldPath }]);
      }
      if (method === "POST") return Response.json({ Key: "new-image" });
    }
    throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
  });
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
  const request = () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
    form.set("clientUploadId", randomUUID());
    return new Request("http://localhost/upload", { method: "POST", headers: { authorization: "Bearer session" }, body: form });
  };
  assert.ok((await uploadImage(request(), workspace)).image.id);
  assert.equal(retained, true);
  assert.equal(deletes, 0);
  storageFails = false;
  assert.ok((await uploadImage(request(), workspace)).image.id);
  assert.equal(removals, 2);
  assert.equal(deletes, 1);
  assert.equal(retained, false);
});

test("private image reads distinguish outages from missing files and check access before storage", async t => {
  configure(t);
  let member = true, visible = true, storageStatus = 503, downloads = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return signedInUser();
    if (url.pathname.endsWith("chair_memberships")) return Response.json(member ? [{ user_id: user }] : []);
    if (url.pathname.endsWith("chair_chat_images")) {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer session");
      assert.equal(url.searchParams.get("workspace_id"), `eq.${workspace}`);
      assert.equal(url.searchParams.get("id"), `eq.${oldId}`);
      return Response.json(visible ? [{ object_path: oldPath }] : []);
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      downloads++;
      if (storageStatus !== 200)
        return Response.json({ statusCode: String(storageStatus), message: "Unavailable" }, { status: storageStatus });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
    }
    throw new Error("Unexpected test request");
  });
  const request = () => new Request("http://localhost/image", { headers: { authorization: "Bearer session" } });
  await assert.rejects(readImage(request(), workspace, oldId),
    (e: unknown) => e instanceof WorkspaceError && e.status === 503);
  storageStatus = 404;
  await assert.rejects(readImage(request(), workspace, oldId),
    (e: unknown) => e instanceof WorkspaceError && e.status === 404);
  storageStatus = 200;
  const image = await readImage(request(), workspace, oldId);
  assert.equal(image.headers.get("cache-control"), "no-store, private");
  assert.equal(image.headers.get("vary"), "Authorization");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [1, 2, 3]);
  visible = false;
  await assert.rejects(readImage(request(), workspace, oldId),
    (e: unknown) => e instanceof WorkspaceError && e.status === 404);
  member = false;
  await assert.rejects(readImage(request(), workspace, oldId),
    (e: unknown) => e instanceof WorkspaceError && e.status === 404);
  assert.equal(downloads, 3, "unavailable images/workspaces must never reach service-key storage");
});
