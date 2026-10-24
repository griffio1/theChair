import { NextResponse, after } from "next/server";
import { handlePush, verifySignature } from "../../../../../github/webhook";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/github/webhook  (GitHub: content type application/json, events: push)
export async function POST(req: Request) {
  if (!process.env.GITHUB_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Webhook signing is not configured" },
      { status: 503 },
    );
  }
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true });
  if (event !== "push")
    return NextResponse.json({ ignored: event }, { status: 202 });

  // Reply to GitHub fast; do the analysis after the response.
  const payload = JSON.parse(raw);
  after(async () => {
    try {
      await handlePush(payload);
    } catch (e) {
      console.error("[webhook]", e);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
