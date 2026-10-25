import { respond, workspaceRequest } from "../../../../lib/workspace-server";
import {deleteWorkspace} from '../../../../lib/workspace-delete';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ segments?: string[] }> };

export async function GET(req: Request, context: Context) {
  const { segments = [] } = await context.params;
  return respond(() => workspaceRequest(req, segments));
}
export async function POST(req: Request, context: Context) {
  const { segments = [] } = await context.params;
  return respond(() => workspaceRequest(req, segments));
}
export async function DELETE(req:Request,context:Context){
  const {segments=[]}=await context.params;
  if(segments.length!==1)return Response.json({error:'Not found.'},{status:404});
  return respond(()=>deleteWorkspace(req,segments[0]));
}
