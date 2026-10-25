import { adminDatabase } from "./workspace-integrations";
import { usageLimit, validId, WorkspaceError } from "./workspace-server";

export type ProductionAction = "ai_chat" | "preflight" | "proposal" | "extraction";

/** Server only. IDs must come from verified identity or the stored connection. */
export async function consumeWorkspaceBudget(workspaceId: string, actorId: string, action: ProductionAction): Promise<void> {
  validId(workspaceId); validId(actorId);
  const result = await adminDatabase().rpc("chair_consume_server_budget", {
    p_workspace: workspaceId, p_actor: actorId, p_action: action,
  });
  usageLimit(result.error);
  if (result.error?.code === "42501")
    throw new WorkspaceError(403, "This account no longer has access to that action.");
  if (result.error)
    throw new WorkspaceError(503, "Usage checks aren't available. Try again later.");
}
