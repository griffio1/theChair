import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { requireTeam } from "./legacy-access";
import {
  readBody,
  textField,
  validId,
  WorkspaceError,
} from "./workspace-server";

export function adminDatabase() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key)
    throw new WorkspaceError(503, "Workspace connections are not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        }),
    },
  });
}
function checked(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === "23505")
    throw new WorkspaceError(
      409,
      "That repository is already connected to a workspace.",
    );
  throw new WorkspaceError(
    503,
    "Workspace connections are unavailable. Check the migration and try again.",
  );
}
function metadata(r: any) {
  return {
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  };
}
function repository(r: any) {
  return r
    ? { name: r.repository, id: r.repository_id, connectedAt: r.connected_at }
    : null;
}

export async function integrationsRequest(
  req: Request,
  workspaceId: string,
  parts: string[],
) {
  validId(workspaceId);
  const headers = new Headers(req.headers);
  headers.set("x-thechair-workspace", workspaceId);
  const identity = await requireTeam(new Request(req.url, { headers }), {
    ownerOnly: true,
  });
  const db = adminDatabase();
  if (!parts.length && req.method === "GET") {
    const [repo, credentials] = await Promise.all([
      db
        .from("chair_repository_connections")
        .select("repository,repository_id,connected_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      db
        .from("chair_agent_credentials")
        .select("id,label,created_at,expires_at,revoked_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
    ]);
    checked(repo.error);
    checked(credentials.error);
    return {
      repository: repository(repo.data),
      credentials: (credentials.data ?? []).map(metadata),
      webhookUrl: new URL("/api/github/webhook", req.url).href,
    };
  }
  if (
    parts.length === 1 &&
    parts[0] === "repository" &&
    req.method === "POST"
  ) {
    const body = await readBody(req);
    const name = textField(body, "repository", 200);
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(name))
      throw new WorkspaceError(400, "Use owner/repository.");
    const token = textField(body, "token", 500);
    const secret = textField(body, "webhookSecret", 256);
    if (secret.length < 32)
      throw new WorkspaceError(
        400,
        "Use a webhook secret of at least 32 characters.",
      );
    const response = await fetch(`https://api.github.com/repos/${name}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok)
      throw new WorkspaceError(
        400,
        "GitHub could not verify that repository and token.",
      );
    const info = await response.json();
    if (
      !info.permissions?.admin ||
      !info.permissions?.push ||
      !Number.isSafeInteger(info.id)
    )
      throw new WorkspaceError(
        403,
        "Use a token for an account with administration and push access to this repository.",
      );
    const existing = await db
      .from("chair_repository_connections")
      .select("repository_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    checked(existing.error);
    if (existing.data && existing.data.repository_id !== info.id)
      throw new WorkspaceError(
        409,
        "This workspace already has a different repository. Create a separate workspace for a different project.",
      );
    const result = await db
      .from("chair_repository_connections")
      .upsert(
        {
          workspace_id: workspaceId,
          repository_id: info.id,
          repository: info.full_name.toLowerCase(),
          token,
          webhook_secret: secret,
          connected_by: identity.userId,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" },
      )
      .select("repository,repository_id,connected_at")
      .single();
    checked(result.error);
    return { repository: repository(result.data) };
  }
  if (parts.length === 1 && parts[0] === "agents" && req.method === "POST") {
    const body = await readBody(req),
      token = randomBytes(32).toString("hex");
    const result = await db
      .from("chair_agent_credentials")
      .insert({
        workspace_id: workspaceId,
        issued_by: identity.userId,
        label: textField(body, "label", 80),
        token_hash: createHash("sha256").update(token).digest("hex"),
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      })
      .select("id,label,created_at,expires_at,revoked_at")
      .single();
    checked(result.error);
    return { credential: metadata(result.data), token };
  }
  if (
    parts.length === 3 &&
    parts[0] === "agents" &&
    parts[2] === "revoke" &&
    req.method === "POST"
  ) {
    const result = await db
      .from("chair_agent_credentials")
      .update({ revoked_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("id", validId(parts[1]))
      .select("id,label,created_at,expires_at,revoked_at")
      .maybeSingle();
    checked(result.error);
    if (!result.data) throw new WorkspaceError(404, "Credential not found.");
    return { credential: metadata(result.data) };
  }
  throw new WorkspaceError(404, "Route not found.");
}
