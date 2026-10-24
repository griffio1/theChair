import { NextResponse } from "next/server";
import type { ChatRequest } from "../../../../shared/types";
import { handleChat } from "../../../../server/chat";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  return NextResponse.json(await handleChat(body));
}
