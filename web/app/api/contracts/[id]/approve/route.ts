import { inWorkspace } from "../../../../../../server/workspace-context";
import { approveContract } from "../../../../../../server/approve";
import { requireTeam } from "../../../../../lib/legacy-access";
import {
  readBody,
  respond,
  WorkspaceError,
} from "../../../../../lib/workspace-server";

export const runtime = "nodejs";

// POST /api/contracts/:id/approve  body: { version: number, approvedBy: string }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const identity = await requireTeam(req, { ownerOnly: true });
    const { id } = await params;
    const { version } = await readBody(req);
    if (
      !/^[a-z0-9-]{1,100}$/.test(id) ||
      !Number.isSafeInteger(version) ||
      version < 1
    )
      throw new WorkspaceError(400, "Invalid contract version.");
    return inWorkspace(identity.workspaceId, () =>
      approveContract(id, version, identity.name),
    );
  });
}
