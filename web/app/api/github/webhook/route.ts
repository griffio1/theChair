import { NextResponse, after } from "next/server";
import { handlePush, verifySignature } from "../../../../../github/webhook";
import { inWorkspace } from "../../../../../server/workspace-context";
import { adminDatabase } from "../../../../lib/workspace-integrations";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 2_000_000)
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const id = payload?.repository?.id;
  if (!Number.isSafeInteger(id))
    return NextResponse.json({ error: "Repository required" }, { status: 400 });
  const { data: connection, error } = await adminDatabase()
    .from("chair_repository_connections")
    .select("workspace_id,webhook_secret,repository")
    .eq("repository_id", id)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: "Webhook storage unavailable" },
      { status: 503 },
    );
  if (
    !connection ||
    !verifySignature(
      raw,
      req.headers.get("x-hub-signature-256"),
      connection.webhook_secret,
    )
  )
    return NextResponse.json(
      { error: "Invalid signature or repository" },
      { status: 401 },
    );
  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true });
  if (event !== "push")
    return NextResponse.json({ ignored: event }, { status: 202 });
  if (
    typeof payload.ref !== "string" ||
    !payload.ref.startsWith("refs/heads/") ||
    !/^[a-f0-9]{40,64}$/.test(payload.before) ||
    !/^[a-f0-9]{40,64}$/.test(payload.after)
  )
    return NextResponse.json({ error: "Invalid push" }, { status: 400 });
  if (payload.deleted)
    return NextResponse.json({ ignored: "deleted branch" }, { status: 202 });
  after(async () => {
    try {
      await inWorkspace(connection.workspace_id, () => handlePush(payload));
    } catch {
      console.error(
        "[webhook] Workspace push check failed; retry the delivery.",
      );
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
