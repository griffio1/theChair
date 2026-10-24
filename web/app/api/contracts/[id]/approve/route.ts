import { NextResponse } from "next/server";
import { approveContract } from "../../../../../../server/approve";

export const runtime = "nodejs";

// POST /api/contracts/:id/approve  body: { version: number, approvedBy: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { version, approvedBy } = (await req.json()) as { version: number; approvedBy: string };
  return NextResponse.json(await approveContract(id, version, approvedBy ?? "someone"));
}
