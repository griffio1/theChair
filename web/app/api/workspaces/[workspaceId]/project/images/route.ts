import {respond} from "../../../../../../lib/workspace-server";
import {uploadImage} from "../../../../../../lib/chat-images";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, context: {params: Promise<{workspaceId: string}>}) {
  const {workspaceId} = await context.params;
  return respond(() => uploadImage(req, workspaceId, true));
}
