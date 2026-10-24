import { NextResponse } from "next/server";
import { getContracts } from "../../../../server/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/contracts  (?all=1 includes proposed and superseded versions)
export async function GET(req: Request) {
  const all = new URL(req.url).searchParams.get("all") === "1";
  return NextResponse.json(await getContracts(all));
}
