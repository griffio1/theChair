import { integrationsRequest } from "../../../../../../lib/workspace-integrations";
import { respond } from "../../../../../../lib/workspace-server";
export const runtime = "nodejs";
async function handle(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string; segments?: string[] }> },
) {
  return respond(async () => {
    const { workspaceId, segments = [] } = await params;
    return integrationsRequest(req, workspaceId, segments);
  });
}
export { handle as GET, handle as POST };
