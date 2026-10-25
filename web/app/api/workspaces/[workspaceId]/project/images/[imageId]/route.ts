import {respond} from "../../../../../../../lib/workspace-server";
import {readImage} from "../../../../../../../lib/chat-images";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request, context: {params: Promise<{workspaceId: string; imageId: string}>}) {
  const {workspaceId,imageId} = await context.params;
  try {return await readImage(req,workspaceId,imageId,true);}
  catch (error) {return respond(async () => {throw error;});}
}
