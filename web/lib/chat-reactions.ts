import { authenticate, readBody, validId, WorkspaceError } from "./workspace-server";

export async function chatReactions(req: Request, workspaceId: string, conversationId: string, messageId?: string) {
  const { db } = await authenticate(req);
  const scope = { p_workspace: validId(workspaceId), p_chat: conversationId === "team" ? null : validId(conversationId) };
  let result;
  if (messageId) {
    const body = await readBody(req);
    if (typeof body.active !== "boolean" || !["👍","❤️","😂","😮","😢","🎉"].includes(body.emoji))
      throw new WorkspaceError(400, "Choose a supported reaction.");
    result = await db.rpc("chair_set_reaction", { ...scope, p_message: validId(messageId), p_emoji: body.emoji, p_active: body.active });
  } else result = await db.rpc("chair_read_reactions", scope);
  if (result.error?.code === "42501") throw new WorkspaceError(403, "This conversation is unavailable.");
  if (result.error?.code === "22023") throw new WorkspaceError(400, "Invalid reaction.");
  if (result.error) throw new WorkspaceError(503, "Reactions are unavailable. Apply chat-reactions.sql in Supabase and try again.");
  return { reactions: result.data };
}
