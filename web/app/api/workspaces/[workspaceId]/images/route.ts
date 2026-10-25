import { uploadImage } from "../../../../../lib/chat-images";
import { respond } from "../../../../../lib/workspace-server";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(req: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return respond(async () => uploadImage(req, (await context.params).workspaceId));
}
