import { shareUrl } from "./site-url";
import { RepositoryNotConnectedError } from "../../server/github";
import { ApprovalError } from "../../server/approve";
import { ProposalInputError } from "../../server/propose";
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Workspace,
  WorkspaceChat,
  WorkspaceInvitation,
  WorkspaceMessage,
} from "./workspace-types";

export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type Row = Record<string, any>;
type Context = { db: SupabaseClient; userId: string };

export function validId(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new WorkspaceError(400, "This item is not valid. Refresh and try again.");
  return value;
}
export function textField(body: Row, key: string, max: number, label?: string): string {
  const value = body[key];
  const labels: Record<string, string> = {
    name: "name", title: "chat name", email: "email address", body: "message",
    repository: "GitHub project", token: "access key", webhookSecret: "shared secret", label: "name",
  };
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new WorkspaceError(
      400,
      `Enter your ${label ?? labels[key] ?? key} (up to ${max} characters).`,
    );
  return value.trim();
}
export async function readBody(req: Request): Promise<Row> {
  // Bound the stream itself; Content-Length alone is not trustworthy.
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new WorkspaceError(415, "Can't read this request. Refresh and try again.");
  const reader = req.body?.getReader();
  if (!reader) throw new WorkspaceError(400, "Nothing was sent. Please try again.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new WorkspaceError(413, "Too much was sent. Send less and try again.");
      }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid body");
    return body;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(400, "Can't read what was sent. Please try again.");
  } finally {
    reader.releaseLock();
  }
}

export function usageLimit(error: { code?: string; message?: string } | null) {
  if (error?.code === "PT429")
    throw new WorkspaceError(429, error.message || "Usage limit reached. Try again later.");
}
function check(error: { code?: string; message?: string } | null) {
  if (!error) return;
  usageLimit(error);
  if (["42P01", "PGRST202", "PGRST205"].includes(error.code ?? ""))
    throw new WorkspaceError(
      503,
      "Workspace setup is missing. Ask the owner to run the missing SQL file in Supabase.",
    );
  if (error.code === "42501")
    throw new WorkspaceError(
      403,
      error.message === "Confirm your email before creating a workspace."
        ? error.message
        : "You don't have access to this action or invite.",
    );
  if (error.code === "22023")
    throw new WorkspaceError(
      400,
      "Check your details. The invite may have expired.",
    );
  if (error.code === "23505")
    throw new WorkspaceError(
      409,
      "This person or message is already saved. Refresh and try again.",
    );
  throw new WorkspaceError(
    503,
    "Can't reach your workspace. Try again.",
  );
}

export async function authenticate(req: Request): Promise<Context> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/i.test(authorization))
    throw new WorkspaceError(401, "Sign in to continue.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new WorkspaceError(503, "Sign-in needs setup. Ask the owner for help.");
  // Use the caller's session, never the service key: RLS applies to every query.
  const db = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: authorization },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        }),
    },
  });
  let result;
  try {
    result = await db.auth.getUser(authorization.slice(7));
  } catch {
    throw new WorkspaceError(503, "Can't check your sign-in right now. Try again.");
  }
  // An auth outage is not an expired session. Returning 401 for a timeout or
  // rate limit makes clients discard working credentials and ask users to log in.
  if (result.error && ![400, 401, 403].includes(result.error.status ?? 0))
    throw new WorkspaceError(503, "Can't check your sign-in right now. Try again.");
  if (result.error || !result.data.user)
    throw new WorkspaceError(401, "Your sign-in expired. Please sign in again.");
  return { db, userId: result.data.user.id };
}

const workspace = (r: Row, role: Workspace["role"]): Workspace => ({
  id: r.id,
  name: r.name,
  role,
  createdAt: r.created_at,
  ...(r.slug ? {slug: r.slug} : {}),
});
const chat = (r: Row): WorkspaceChat => ({
  id: r.id,
  workspaceId: r.workspace_id,
  title: r.title,
  createdAt: r.created_at,
});
const message = (r: Row): WorkspaceMessage => ({
  deletedAt: r.deleted_at ?? null,
  id: r.id,
  chatId: r.chat_id,
  workspaceId: r.workspace_id,
  author: { userId: r.author_id, name: r.author_name, type: "human" },
  body: r.body,
  images: r.images ?? [],
  createdAt: r.created_at,
});
const invitation = (r: Row): WorkspaceInvitation => ({
  id: r.id,
  email: r.email,
  status: r.accepted_at
    ? "accepted"
    : Date.parse(r.expires_at) <= Date.now()
      ? "expired"
      : "pending",
  expiresAt: r.expires_at,
});

async function membership(ctx: Context, id: string) {
  validId(id);
  const { data, error } = await ctx.db
    .from("chair_memberships")
    .select("role")
    .eq("workspace_id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  check(error);
  if (!data) throw new WorkspaceError(404, "Workspace unavailable.");
  return data.role as Workspace["role"];
}

export async function workspaceRequest(req: Request, parts: string[]) {
  const ctx = await authenticate(req);
  const { db } = ctx;
  if (!parts.length) {
    if (req.method === "GET") {
      const [spaces, roles] = await Promise.all([
        db
          .from("chair_workspaces")
          .select("id,name,slug,created_at")
          .order("created_at"),
        db
          .from("chair_memberships")
          .select("workspace_id,role")
          .eq("user_id", ctx.userId),
      ]);
      check(spaces.error);
      check(roles.error);
      const byId = new Map(
        (roles.data ?? []).map((r) => [r.workspace_id, r.role]),
      );
      return {
        workspaces: (spaces.data ?? []).map((s) =>
          workspace(s, byId.get(s.id) as Workspace["role"]),
        ),
      };
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const { data, error } = await db.rpc("chair_create_workspace", {
        p_name: textField(body, "name", 80),
      });
      check(error);
      return {
        workspace: workspace(data.workspace, "owner"),
        chat: chat(data.chat),
      };
    }
  }
  if (!parts[0]) throw new WorkspaceError(404, "That action isn't available.");
  const workspaceId = validId(parts[0]);
  if (req.method === "GET" && parts.length === 4 && parts[1] === "chats" && parts[3] === "messages") {
    const chatId = validId(parts[2]);
    // These reads all use the caller's JWT/RLS; independent authorization and data
    // reads can run together instead of adding three sequential network waits.
    const [, found, rows] = await Promise.all([
      membership(ctx, workspaceId),
      db.from("chair_chats").select("id").eq("workspace_id", workspaceId).eq("id", chatId).maybeSingle(),
      db.from("chair_messages").select("id,workspace_id,chat_id,author_id,author_name,body,images,created_at,deleted_at")
        .eq("workspace_id", workspaceId).eq("chat_id", chatId)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200),
    ]);
    check(found.error); check(rows.error);
    if (!found.data) throw new WorkspaceError(404, "Chat unavailable.");
    return { messages: (rows.data ?? []).reverse().map(message) };
  }
  const role = await membership(ctx, workspaceId);
  if (parts.length === 1 && req.method === "GET") {
    const results = await Promise.all([
      db
        .from("chair_workspaces")
        .select("id,name,created_at")
        .eq("id", workspaceId)
        .single(),
      db
        .from("chair_chats")
        .select("id,workspace_id,title,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at"),
      db
        .from("chair_memberships")
        .select("user_id,display_name,role,joined_at")
        .eq("workspace_id", workspaceId)
        .order("joined_at"),
      db
        .from("chair_invitations")
        .select("id,email,expires_at,accepted_at")
        .eq("workspace_id", workspaceId)
        .order("created_at"),
      db.from("contracts").select("*").eq("workspace_id", workspaceId).order("id").order("version", { ascending: false }),
      db.from("conflicts").select("*").eq("workspace_id", workspaceId),
      db.rpc("chair_identity_workspace", {p_workspace:workspaceId}),
    ]);
    for (const r of results) check(r.error);
    const [w, chats, members, invitations, legacyContracts, legacyConflicts, identity] = results;
    const usernames = new Map<string,string|null>((identity.data?.usernames ?? []).map((p:Row)=>[p.userId,p.username]));
    let contractRows: Row[];
    let conflictRows: Row[];
    {
      // Every ledger query is scoped, including when a user belongs to several teams.
      // Query with the caller's JWT so direct database RLS remains authoritative.
      check(legacyContracts.error);
      check(legacyConflicts.error);
      contractRows = (legacyContracts.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        method: r.method,
        path: r.path,
        request: r.request,
        response: r.response,
        version: r.version,
        status: r.status,
        owner: r.owner,
        notes: r.notes,
      }));
      conflictRows = (legacyConflicts.data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        severity: r.severity,
        summary: r.summary,
        contractId: r.contract_id,
        affectedPaths: r.affected_paths,
        suggestedFix: r.suggested_fix,
        status: r.status,
        detectedBy: r.detected_by,
        agent: r.agent,
        developer: r.developer,
        evidence: r.evidence,
        createdAt: r.created_at,
      }));
    }
    return {
      workspace: workspace(w.data!, role),
      chats: ((chats.data as Row[]) ?? []).map(chat),
      members: ((members.data as Row[]) ?? []).map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        username: usernames.get(r.user_id) ?? null,
        role: r.role,
        joinedAt: r.joined_at,
      })),
      invitations: [...((invitations.data as Row[]) ?? []).map(invitation),...(identity.data?.invitations ?? [])],
      contracts: contractRows,
      conflicts: conflictRows,
    };
  }
  if (
    parts.length === 4 &&
    parts[1] === "members" &&
    parts[3] === "role" &&
    req.method === "POST"
  ) {
    if (role !== "owner")
      throw new WorkspaceError(403, "Only owners can change roles.");
    const body = await readBody(req);
    if (body.role !== "owner" && body.role !== "member")
      throw new WorkspaceError(400, "Choose owner or member.");
    const result = await db.rpc("chair_change_member_role", {
      p_workspace: workspaceId,
      p_user: validId(parts[2]),
      p_role: body.role,
    });
    if (result.error?.code === "23514")
      throw new WorkspaceError(
        409,
        "A workspace must have at least one owner.",
      );
    check(result.error);
    return { member: result.data };
  }
  if (parts.length === 2 && parts[1] === "chats" && req.method === "POST") {
    const body = await readBody(req);
    const { data, error } = await db
      .rpc("chair_create_chat", {
        p_workspace: workspaceId,
        p_title: textField(body, "title", 80),
      })
      .single<Row>();
    check(error);
    if (!data)
      throw new WorkspaceError(
        503,
        "Can't confirm the new chat. Refresh before trying again.",
      );
    return { chat: chat(data) };
  }
  if (parts.length === 4 && parts[1] === "chats" && parts[3] === "messages") {
    const chatId = validId(parts[2]);
    const found = await db
      .from("chair_chats")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", chatId)
      .maybeSingle();
    check(found.error);
    if (!found.data) throw new WorkspaceError(404, "Chat unavailable.");
    if (req.method === "POST") {
      const body = await readBody(req);
      const { imageMessageInput } = await import("./chat-images");
      const input = imageMessageInput(body);
      const { data, error } = await db
        .rpc("chair_send_images", {
          p_workspace: workspaceId,
          p_chat: chatId,
          ...input,
        });
      check(error);
      if (!data)
        throw new WorkspaceError(
          503,
          "Can't confirm your message was sent. Try again to check.",
        );
      return { messages: [message(data)] };
    }
  }
  if (
    parts.length === 2 &&
    parts[1] === "invitations" &&
    req.method === "POST"
  ) {
    if (role !== "owner")
      throw new WorkspaceError(403, "Only owners can invite people.");
    const body = await readBody(req);
    if (body.username !== undefined) {
      const {normalizeUsername,usernameError}=await import('./usernames');
      const {identityError}=await import('./identity-server');
      if(body.email!==undefined || typeof body.username!=='string' || usernameError(body.username))throw new WorkspaceError(400,'Enter one valid username.');
      const token=randomBytes(32).toString('hex');
      const result=await db.rpc('chair_invite_username',{p_workspace:workspaceId,p_username:normalizeUsername(body.username),p_token_hash:createHash('sha256').update(token).digest('hex')});
      identityError(result.error);
      const {reused,...saved}=result.data;
      return {invitation:{...saved,...(!reused?{inviteUrl:shareUrl(`/workspaces#invite=${token}`,req.url)}:{})}};
    }
    const email = textField(body, "email", 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new WorkspaceError(400, "Enter a valid email address.");
    const token = randomBytes(32).toString("hex");
    const { data, error } = await db.rpc("chair_create_invitation", {
      p_workspace: workspaceId,
      p_email: email,
      p_token_hash: createHash("sha256").update(token).digest("hex"),
    });
    check(error);
    return {
      invitation: {
        ...invitation(data),
        inviteUrl: shareUrl(`/workspaces#invite=${token}`, req.url),
      },
    };
  }
  throw new WorkspaceError(404, "That action isn't available.");
}

export async function acceptInvitation(req: Request) {
  const { db } = await authenticate(req);
  const body = await readBody(req);
  const token = textField(body, "token", 64, "invite code");
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new WorkspaceError(400, "This invite link is not valid. Ask for a new one.");
  const { data, error } = await db.rpc("chair_accept_any_invitation", {
    p_token_hash: createHash("sha256").update(token).digest("hex"),
  });
  const {identityError}=await import('./identity-server');
  identityError(error);
  return { workspaceId: data as string };
}

export async function respond(run: () => Promise<unknown>): Promise<Response> {
  const headers = {
    "cache-control": "no-store, private",
    vary: "Authorization",
  };
  try {
    return Response.json(await run(), { headers });
  } catch (error) {
    const known =
      error instanceof RepositoryNotConnectedError
        ? new WorkspaceError(409, "Connect a GitHub project before continuing.")
        : error instanceof WorkspaceError || error instanceof ApprovalError || error instanceof ProposalInputError
          ? error
          : null;
    return Response.json(
      {
        error: known
          ? known.message
          : "Something went wrong. Try again.",
      },
      { status: known ? known.status : 500, headers },
    );
  }
}
