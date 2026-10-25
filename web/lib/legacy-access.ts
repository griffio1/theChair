import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authenticate, validId, WorkspaceError } from "./workspace-server";

export interface TeamIdentity {
  workspaceId: string;
  name: string;
  role: "owner" | "member" | "agent";
  userId?: string;
}

function unavailable(error: unknown) {
  if (error)
    throw new WorkspaceError(
      503,
      "Can't check access. Try again, or ask the owner.",
    );
}

/** Every legacy route must call this BEFORE parsing or invoking service-key code. */
export async function requireTeam(
  req: Request,
  options: { allowAgent?: boolean; ownerOnly?: boolean } = {},
): Promise<TeamIdentity> {
  const credential = req.headers.get("x-thechair-agent-token");
  if (credential && options.allowAgent && !options.ownerOnly) {
    if (!/^[a-f0-9]{64}$/.test(credential))
      throw new WorkspaceError(401, "This AI tool's access key is not valid.");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key)
      throw new WorkspaceError(503, "AI tools need setup. Ask the owner for help.");
    const admin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          }),
      },
    });
    const { data: agent, error } = await admin
      .from("chair_agent_credentials")
      .select("workspace_id,issued_by,label")
      .eq("token_hash", createHash("sha256").update(credential).digest("hex"))
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    unavailable(error);
    if (!agent)
      throw new WorkspaceError(401, "This access key expired or was turned off. Ask the owner for a new one.");
    const requested = req.headers.get("x-thechair-workspace");
    if (requested && requested !== agent.workspace_id)
      throw new WorkspaceError(
        403,
        "This access key is for another workspace.",
      );
    const issuer = await admin
      .from("chair_memberships")
      .select("user_id")
      .eq("workspace_id", agent.workspace_id)
      .eq("user_id", agent.issued_by)
      .eq("role", "owner")
      .maybeSingle();
    unavailable(issuer.error);
    if (!issuer.data)
      throw new WorkspaceError(
        403,
        "This key's creator is no longer an owner. Ask a current owner for a new key.",
      );
    return {
      workspaceId: agent.workspace_id,
      name: agent.label,
      role: "agent",
    };
  }
  const ctx = await authenticate(req);
  let workspaceId = req.headers.get("x-thechair-workspace");
  if (workspaceId) workspaceId = validId(workspaceId);
  else {
    // Compatibility for old clients: only the explicitly bound legacy team.
    const binding = await ctx.db
      .from("chair_legacy_binding")
      .select("workspace_id")
      .maybeSingle();
    unavailable(binding.error);
    workspaceId = binding.data?.workspace_id;
  }
  if (!workspaceId)
    throw new WorkspaceError(403, "Choose a workspace you belong to.");
  const member = await ctx.db
    .from("chair_memberships")
    .select("display_name,role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  unavailable(member.error);
  if (!member.data || (options.ownerOnly && member.data.role !== "owner"))
    throw new WorkspaceError(
      403,
      !member.data ? "You don't have access to this workspace." : "Only owners can do this.",
    );
  return {
    workspaceId: workspaceId,
    userId: ctx.userId,
    name: member.data.display_name,
    role: member.data.role,
  };
}
