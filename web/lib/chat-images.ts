import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authenticate, readBody, validId, usageLimit, WorkspaceError } from "./workspace-server";
import { MAX_IMAGE_BYTES, normalizeImage } from "./image-validation";

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
async function member(req: Request, workspaceId: string, ownerOnly = false) {
  validId(workspaceId);
  const ctx = await authenticate(req);
  const found = await ctx.db.from("chair_memberships").select("user_id,role")
    .eq("workspace_id", workspaceId).eq("user_id", ctx.userId).maybeSingle();
  if (found.error) throw unavailable();
  if (!found.data) throw new WorkspaceError(404, "Workspace unavailable.");
  if (ownerOnly && found.data.role !== "owner") throw new WorkspaceError(403, "Only owners can upload project images.");
  return ctx;
}
export const imageMetadata = (r: Record<string, any>) => ({
  id: r.id, name: r.name, mimeType: r.mime_type, width: r.width, height: r.height, size: r.size,
});

function draftsOnly(query: any, project: boolean) {
  return project ? query.eq("attached",false) : query.is("message_id",null).is("team_message_id",null);
}
export async function uploadImage(req: Request, workspaceId: string, project = false) {
  const ctx = await member(req, workspaceId, project);
  const table = project ? "chair_project_images" : "chair_chat_images";
  const bucket = project ? "chair-project-images" : "chair-chat-images";
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
  const expired = await draftsOnly(admin.from(table).select("id,object_path")
    .eq("workspace_id", workspaceId).eq("uploaded_by", ctx.userId), project)
    .lt("created_at", new Date(Date.now() - 86400000).toISOString()).limit(100);
  if (expired.error) throw unavailable();
  if (expired.data.length) {
    // Hide each draft before deleting its object. Message attachment locks the
    // same row and requires ready=true, so it cannot race with this cleanup.
    // Keep the row until storage confirms removal: its path lets later uploads
    // retry cleanup after an outage rather than leaving an unreachable object.
    const retired = await draftsOnly(admin.from(table).update({ ready: false })
      .in("id", expired.data.map((r: {id: string}) => r.id)), project)
      .select("id,object_path");
    if (!retired.error && retired.data.length) {
      const removed = await admin.storage.from(bucket).remove(retired.data.map((r: {object_path: string}) => r.object_path));
      if (!removed.error)
        await draftsOnly(admin.from(table).delete().in("id", retired.data.map((r: {id: string}) => r.id))
          .eq("ready", false), project);
    }
  }
  const id = randomUUID();
  const row = {
    id, workspace_id: workspaceId, uploaded_by: ctx.userId, client_upload_id: clientId,
    name: (file.name.replace(/[\x00-\x1f\x7f/\\]/g, "").slice(0, 150) || "Image"),
    mime_type: "image/webp", width: normalized.width, height: normalized.height,
    size: normalized.bytes.length, content_hash: hash,
    object_path: `${workspaceId}/${ctx.userId}/${id}.webp`,
  };
  const inserted = await admin.from(table).insert(row).select("*").single();
  usageLimit(inserted.error);
  let saved = inserted.data;
  if (inserted.error?.code === "23505") {
    const previous = await admin.from(table).select("*").eq("workspace_id", workspaceId)
      .eq("uploaded_by", ctx.userId).eq("client_upload_id", clientId).single();
    if (previous.error) throw unavailable();
    saved = previous.data;
    if (saved.content_hash !== hash) throw new WorkspaceError(409, "This upload changed. Choose the image again.");
  } else if (inserted.error) throw unavailable();
  if (!saved) throw unavailable();
  if (!saved.ready) {
    const uploaded = await admin.storage.from(bucket).upload(saved.object_path, normalized.bytes, { contentType: "image/webp", upsert: false });
    if (uploaded.error && String((uploaded.error as { statusCode?: string }).statusCode) !== "409") throw unavailable();
    const ready = await admin.from(table).update({ ready: true }).eq("id", saved.id);
    if (ready.error) throw unavailable();
  }
  return { image: imageMetadata(saved) };
}

export async function readImage(req: Request, workspaceId: string, imageId: string, project = false) {
  const ctx = await member(req, workspaceId);
  // The caller's JWT enforces pending-uploader and attached-member access via RLS.
  const image = await ctx.db.from(project ? "chair_project_images" : "chair_chat_images").select("*")
    .eq("workspace_id", workspaceId).eq("id", validId(imageId)).maybeSingle();
  if (image.error) throw unavailable();
  if (!image.data) throw new WorkspaceError(404, "Image unavailable.");
  const result = await adminClient().storage.from(project ? "chair-project-images" : "chair-chat-images").download(image.data.object_path);
  if (result.error) {
    const status = Number((result.error as { status?: number; statusCode?: string }).statusCode ??
      (result.error as { status?: number }).status);
    if (status === 404) throw new WorkspaceError(404, "Image unavailable.");
    throw unavailable();
  }
  if (!result.data) throw new WorkspaceError(404, "Image unavailable.");
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
  usageLimit(result.error);
  if (result.error?.code === "42501") throw new WorkspaceError(403, "Can't use an image. Remove it and upload it again.");
  if (result.error?.code === "23505") throw new WorkspaceError(409, "This message was already sent with different text or images.");
  if (result.error) throw unavailable();
  const r = result.data;
  return { messages: [{ id: r.id, author: { type: r.author_type, name: r.author_name },
    kind: r.kind, body: r.body, images: r.images, createdAt: r.created_at }] };
}
