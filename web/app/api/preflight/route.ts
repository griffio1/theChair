import { inWorkspace } from "../../../../server/workspace-context";
import type { PreflightRequest } from "../../../../shared/types";
import { runPreflight } from "../../../../server/preflight";
import { requireTeam } from "../../../lib/legacy-access";
import {
  readBody,
  respond,
  WorkspaceError,
} from "../../../lib/workspace-server";

export const runtime = "nodejs";

// POST /api/preflight  (?source=hook when called by the Claude Code hook)
export async function POST(req: Request) {
  return respond(async () => {
    const identity = await requireTeam(req, { allowAgent: true });
    const body = await readBody(req);
    if (
      !Array.isArray(body.paths) ||
      !body.paths.every((p: unknown) => typeof p === "string") ||
      typeof body.intent !== "string"
    )
      throw new WorkspaceError(400, "Intent and file paths are required.");
    const source =
      new URL(req.url).searchParams.get("source") === "hook"
        ? "hook"
        : "preflight";
    return inWorkspace(identity.workspaceId, () =>
      runPreflight(
        { ...body, developer: identity.name } as PreflightRequest,
        source,
      ),
    );
  });
}
