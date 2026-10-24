import { acceptInvitation, respond } from "../../../../lib/workspace-server";

export const runtime = "nodejs";
export async function POST(req: Request) {
  return respond(() => acceptInvitation(req));
}
