import { NextResponse } from "next/server";
import type { PreflightRequest } from "../../../../shared/types";
import { runPreflight } from "../../../../server/preflight";

export const runtime = "nodejs";

// POST /api/preflight  (?source=hook when called by the Claude Code hook)
export async function POST(req: Request) {
  const body = (await req.json()) as PreflightRequest;
  const source = new URL(req.url).searchParams.get("source") === "hook" ? "hook" : "preflight";
  return NextResponse.json(await runPreflight(body, source));
}
