import { chatReactions } from "../../../../../../../../../lib/chat-reactions";
import { respond } from "../../../../../../../../../lib/workspace-server";
export const runtime = "nodejs";
export async function POST(req: Request, context: { params: Promise<{ workspaceId: string; conversationId: string; messageId: string }> }) {
  return respond(async () => { const p = await context.params; return chatReactions(req, p.workspaceId, p.conversationId, p.messageId); });
}
