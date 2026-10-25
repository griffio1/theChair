import {respond} from "../../../../../lib/workspace-server";
import {projectRequest} from "../../../../../lib/project-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{workspaceId: string}>};
export async function GET(req: Request, context: Context) {
  const {workspaceId} = await context.params;
  return respond(() => projectRequest(req, workspaceId));
}
export const POST = GET;
