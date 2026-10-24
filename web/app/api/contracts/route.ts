import { getContracts } from "../../../../server/ledger";
import { requireTeam } from "../../../lib/legacy-access";
import { respond } from "../../../lib/workspace-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/contracts  (?all=1 includes proposed and superseded versions)
export async function GET(req: Request) {
  return respond(async () => {
    await requireTeam(req, { allowAgent: true });
    return getContracts(new URL(req.url).searchParams.get("all") === "1");
  });
}
