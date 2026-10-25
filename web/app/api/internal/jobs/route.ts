import { processWebhookJob, schedulerAuthorized } from "../../../../lib/webhook-jobs";
import { respond, WorkspaceError } from "../../../../lib/workspace-server";
import {removeWorkspaceFiles} from '../../../../lib/workspace-delete';
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;

export async function GET(req:Request) {
  return respond(async()=>{
    if (!schedulerAuthorized(req.headers.get("authorization"))) throw new WorkspaceError(401,"Not authorized.");
    const [checks,files]=await Promise.all([processWebhookJob(),removeWorkspaceFiles()]);
    return {processed:checks.processed+files.processed,failed:checks.failed+files.failed};
  });
}
