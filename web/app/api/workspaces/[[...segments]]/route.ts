import { respond, workspaceRequest } from "../../../../lib/workspace-server";

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
