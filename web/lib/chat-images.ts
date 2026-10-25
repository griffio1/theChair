import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authenticate, readBody, validId, WorkspaceError } from "./workspace-server";
import { MAX_IMAGE_BYTES, normalizeImage } from "./image-validation";

const BUCKET = "chair-chat-images";
const unavailable = () => new WorkspaceError(503, "Images aren't available. Try again.");
function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new WorkspaceError(503, "Images need setup. Ask the owner for help.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000) }) },
  });
}
async function member(req: Request, workspaceId: string) {
  validId(workspaceId);
  const ctx = await authenticate(req);
  const found = await ctx.db.from("chair_memberships").select("user_id")
    .eq("workspace_id", workspaceId).eq("user_id", ctx.userId).maybeSingle();
  if (found.error) throw unavailable();
  if (!found.data) throw new WorkspaceError(404, "Workspace unavailable.");
  return ctx;
}
export const imageMetadata = (r: Record<string, any>) => ({
  id: r.id, name: r.name, mimeType: r.mime_type, width: r.width, height: r.height, size: r.size,
});

export async function uploadImage(req: Request, workspaceId: string) {
  const ctx = await member(req, workspaceId);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;"))
    throw new WorkspaceError(415, "Choose an image file to upload.");
  // Bound the actual stream before parsing multipart data; do not trust Content-Length.
  const reader = req.body?.getReader();
  if (!reader) throw new WorkspaceError(400, "Choose an image to upload.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES + 16384) {
        await reader.cancel();
        throw new WorkspaceError(413, "Choose an image smaller than 3 MiB.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Request(req.url, { method: "POST", headers: { "content-type": req.headers.get("content-type")! }, body: Buffer.concat(chunks) }).formData(); }
  catch { throw new WorkspaceError(400, "Couldn't read this image. Choose it again."); }
  const file = form.get("file");
  const clientId = form.get("clientUploadId");
  if (!(file instanceof File) || form.getAll("file").length !== 1 || typeof clientId !== "string")
    throw new WorkspaceError(400, "Choose one image at a time.");
  validId(clientId);
  const normalized = await normalizeImage(Buffer.from(await file.arrayBuffer()));
  const hash = createHash("sha256").update(normalized.bytes).digest("hex");
  const admin = adminClient();

  // Remove only this uploader's expired, unattached drafts. Attached images never expire here.
  const expired = await admin.from("chair_chat_images").select("id,object_path")
    .eq("workspace_id", workspaceId).eq("uploaded_by", ctx.userId)
    .is("message_id", null).is("team_message_id", null)
    .lt("created_at", new Date(Date.now() - 86400000).toISOString()).limit(100);
  if (expired.error) throw unavailable();
  if (expired.data.length) {
    const removed = await admin.from("chair_chat_images").delete().in("id", expired.data.map(r => r.id))
      .is("message_id", null).is("team_message_id", null).select("object_path");
    if (!removed.error && removed.data.length)
      await admin.storage.from(BUCKET).remove(removed.data.map(r => r.object_path));
  }
  const id = randomUUID();
  const row = {
    id, workspace_id: workspaceId, uploaded_by: ctx.userId, client_upload_id: clientId,
    name: (file.name.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 150) || "Image"),
    mime_type: "image/webp", width: normalized.width, height: normalized.height,
    size: normalized.bytes.length, content_hash: hash,
    object_path: `${workspaceId}/${ctx.userId}/${id}.webp`,
  };
  const inserted = await admin.from("chair_chat_images").insert(row).select("*").single();
  let saved = inserted.data;
  if (inserted.error?.code === "23505") {
    const previous = await admin.from("chair_chat_images").select("*").eq("workspace_id", workspaceId)
      .eq("uploaded_by", ctx.userId).eq("client_upload_id", clientId).single();
    if (previous.error) throw unavailable();
    saved = previous.data;
    if (saved.content_hash !== hash) throw new WorkspaceError(409, "This upload changed. Choose the image again.");
  } else if (inserted.error) throw unavailable();
  if (!saved) throw unavailable();
  if (!saved.ready) {
    const uploaded = await admin.storage.from(BUCKET).upload(saved.object_path, normalized.bytes, { contentType: "image/webp", upsert: false });
    if (uploaded.error && String((uploaded.error as { statusCode?: string }).statusCode) !== "409") throw unavailable();
    const ready = await admin.from("chair_chat_images").update({ ready: true }).eq("id", saved.id);
    if (ready.error) throw unavailable();
  }
  return { image: imageMetadata(saved) };
}

export async function readImage(req: Request, workspaceId: string, imageId: string) {
  const ctx = await member(req, workspaceId);
  // The caller's JWT enforces pending-uploader and attached-member access via RLS.
  const image = await ctx.db.from("chair_chat_images").select("*")
    .eq("workspace_id", workspaceId).eq("id", validId(imageId)).maybeSingle();
  if (image.error) throw unavailable();
  if (!image.data) throw new WorkspaceError(404, "Image unavailable.");
  const result = await adminClient().storage.from(BUCKET).download(image.data.object_path);
  if (result.error || !result.data) throw new WorkspaceError(404, "Image unavailable.");
  return new Response(result.data, { headers: {
    "content-type": "image/webp", "content-disposition": "inline",
    "cache-control": "no-store, private", vary: "Authorization", "x-content-type-options": "nosniff",
  } });
}

export function imageMessageInput(body: Record<string, unknown>, required = false) {
  const ids = body.imageIds ?? [];
  if (!Array.isArray(ids) || ids.length > 4 || (required && ids.length === 0) ||
      ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length)
    throw new WorkspaceError(400, "Attach up to four images.");
  const imageIds = ids.map(id => validId(id as string));
  if (typeof body.body !== "string" || body.body.trim().length > 10000 || (!body.body.trim() && !imageIds.length))
    throw new WorkspaceError(400, "Write a message or add an image.");
  if (typeof body.clientMessageId !== "string") throw new WorkspaceError(400, "Can't send this message. Refresh and try again.");
  return { p_body: body.body.trim(), p_client_id: validId(body.clientMessageId), p_images: imageIds };
}
export async function sendTeamImages(req: Request, workspaceId: string) {
  const ctx = await member(req, workspaceId);
  const input = imageMessageInput(await readBody(req), true);
  const result = await ctx.db.rpc("chair_send_images", { p_workspace: workspaceId, p_chat: null, ...input });
  if (result.error?.code === "42501") throw new WorkspaceError(403, "Can't use an image. Remove it and upload it again.");
  if (result.error?.code === "23505") throw new WorkspaceError(409, "This message was already sent with different text or images.");
  if (result.error) throw unavailable();
  const r = result.data;
  return { messages: [{ id: r.id, author: { type: r.author_type, name: r.author_name },
    kind: r.kind, body: r.body, images: r.images, createdAt: r.created_at }] };
}
