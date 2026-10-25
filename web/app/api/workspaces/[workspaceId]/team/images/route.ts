import { sendTeamImages } from "../../../../../../lib/chat-images";
import { respond } from "../../../../../../lib/workspace-server";
export const runtime = "nodejs";
export async function POST(req: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return respond(async () => sendTeamImages(req, (await context.params).workspaceId));
}
