import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { authenticate, WorkspaceError } from "./workspace-server";

export interface TeamIdentity {
  workspaceId: string;
  name: string;
  role: "owner" | "member" | "agent";
}

function unavailable(error: unknown) {
  if (error)
    throw new WorkspaceError(
      503,
      "Team access is not ready. Contact the workspace owner.",
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
      throw new WorkspaceError(401, "Invalid agent credential.");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key)
      throw new WorkspaceError(503, "Agent access is not configured.");
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
      throw new WorkspaceError(401, "Agent credential expired or revoked.");
    const [binding, issuer] = await Promise.all([
      admin
        .from("chair_legacy_binding")
        .select("workspace_id")
        .eq("workspace_id", agent.workspace_id)
        .maybeSingle(),
      admin
        .from("chair_memberships")
        .select("user_id")
        .eq("workspace_id", agent.workspace_id)
        .eq("user_id", agent.issued_by)
        .eq("role", "owner")
        .maybeSingle(),
    ]);
    unavailable(binding.error);
    unavailable(issuer.error);
    if (!binding.data || !issuer.data)
      throw new WorkspaceError(403, "Agent has no access to this team.");
    return {
      workspaceId: agent.workspace_id,
      name: agent.label,
      role: "agent",
    };
  }
  const ctx = await authenticate(req);
  const { data: binding, error } = await ctx.db
    .from("chair_legacy_binding")
    .select("workspace_id")
    .maybeSingle();
  unavailable(error);
  if (!binding)
    throw new WorkspaceError(
      403,
      "Join the workspace that owns this team ledger to continue.",
    );
  const member = await ctx.db
    .from("chair_memberships")
    .select("display_name,role")
    .eq("workspace_id", binding.workspace_id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  unavailable(member.error);
  if (!member.data || (options.ownerOnly && member.data.role !== "owner"))
    throw new WorkspaceError(
      403,
      "Only a workspace owner can approve changes.",
    );
  return {
    workspaceId: binding.workspace_id,
    name: member.data.display_name,
    role: member.data.role,
  };
}
