import { processWebhookJob, schedulerAuthorized } from "../../../../lib/webhook-jobs";
import { respond, WorkspaceError } from "../../../../lib/workspace-server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;

export async function GET(req:Request) {
  return respond(async()=>{
    if (!schedulerAuthorized(req.headers.get("authorization"))) throw new WorkspaceError(401,"Not authorized.");
    return processWebhookJob();
  });
}
