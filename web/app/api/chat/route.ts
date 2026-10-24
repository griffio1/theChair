import { inWorkspace } from "../../../../server/workspace-context";
import { handleChat } from "../../../../server/chat";
import { requireTeam } from "../../../lib/legacy-access";
import { readBody, respond, textField } from "../../../lib/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  return respond(async () => {
    const identity = await requireTeam(req);
    const body = await readBody(req);
    return inWorkspace(identity.workspaceId, () =>
      handleChat({
        author: identity.name,
        body: textField(body, "body", 10000),
      }),
    );
  });
}
