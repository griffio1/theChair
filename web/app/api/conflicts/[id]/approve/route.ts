import { approveConflict } from "../../../../../../server/approve";
import { requireTeam } from "../../../../../lib/legacy-access";
import { respond, validId } from "../../../../../lib/workspace-server";

export const runtime = "nodejs";

// POST /api/conflicts/:id/approve  body: { approvedBy: string }
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const identity = await requireTeam(req, { ownerOnly: true });
    const { id } = await params;
    return approveConflict(validId(id), identity.name);
  });
}
