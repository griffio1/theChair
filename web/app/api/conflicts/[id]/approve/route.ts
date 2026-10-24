import { NextResponse } from "next/server";
import { approveConflict } from "../../../../../../server/approve";

export const runtime = "nodejs";

// POST /api/conflicts/:id/approve  body: { approvedBy: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { approvedBy } = (await req.json().catch(() => ({}))) as { approvedBy?: string };
  return NextResponse.json(await approveConflict(id, approvedBy ?? "someone"));
}
