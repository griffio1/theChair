import { inWorkspace } from "../../../../server/workspace-context";
import { handleChat } from "../../../../server/chat";
import { requireTeam } from "../../../lib/legacy-access";
import { readBody, respond, textField } from "../../../lib/workspace-server";
import { consumeWorkspaceBudget } from "../../../lib/production-limits";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  return respond(async () => {
    const identity = await requireTeam(req);
    const body = await readBody(req);
    const message = textField(body, "body", 10000);
    await consumeWorkspaceBudget(identity.workspaceId, identity.budgetActorId, "ai_chat");
    return inWorkspace(identity.workspaceId, () =>
      handleChat({
        author: identity.name,
        body: message,
      }),
    );
  });
}
