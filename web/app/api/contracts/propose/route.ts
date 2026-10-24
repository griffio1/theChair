import { inWorkspace } from "../../../../../server/workspace-context";
import type { ProposeContractRequest } from "../../../../../shared/types";
import { proposeContract } from "../../../../../server/propose";
import { requireTeam } from "../../../../lib/legacy-access";
import {
  readBody,
  respond,
  WorkspaceError,
} from "../../../../lib/workspace-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return respond(async () => {
    const identity = await requireTeam(req, { allowAgent: true });
    const body = await readBody(req);
    if (
      !body.contract ||
      typeof body.contract !== "object" ||
      Array.isArray(body.contract)
    )
      throw new WorkspaceError(400, "A contract is required.");
    return inWorkspace(identity.workspaceId, () =>
      proposeContract({
        ...body,
        proposedBy: identity.name,
      } as ProposeContractRequest),
    );
  });
}
