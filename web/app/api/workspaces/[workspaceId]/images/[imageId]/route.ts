import { readImage } from "../../../../../../lib/chat-images";
import { respond } from "../../../../../../lib/workspace-server";
export const runtime = "nodejs";
export async function GET(req: Request, context: { params: Promise<{ workspaceId: string; imageId: string }> }) {
  try {
    const { workspaceId, imageId } = await context.params;
    return await readImage(req, workspaceId, imageId);
  } catch (error) { return respond(async () => { throw error; }); }
}
