import { authenticate, readBody, validId, usageLimit, WorkspaceError } from "./workspace-server";

export async function chatReactions(req: Request, workspaceId: string, conversationId: string, messageId?: string) {
  const { db } = await authenticate(req);
  const scope = { p_workspace: validId(workspaceId), p_chat: conversationId === "team" ? null : validId(conversationId) };
  let result;
  if (messageId) {
    const body = await readBody(req);
    if (typeof body.active !== "boolean" || !["👍","❤️","😂","😮","😢","🎉"].includes(body.emoji))
      throw new WorkspaceError(400, "Choose a reaction from the list.");
    result = await db.rpc("chair_set_reaction", { ...scope, p_message: validId(messageId), p_emoji: body.emoji, p_active: body.active });
  } else result = await db.rpc("chair_read_reactions", scope);
  usageLimit(result.error);
  if (result.error?.code === "42501") throw new WorkspaceError(403, "This chat isn't available.");
  if (result.error?.code === "22023") throw new WorkspaceError(400, "Choose a reaction from the list.");
  if (result.error) throw new WorkspaceError(503, "Reactions aren't available. Try again.");
  return { reactions: result.data };
}
