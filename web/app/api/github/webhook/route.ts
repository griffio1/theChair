import { NextResponse, after } from "next/server";
import { verifySignature } from "../../../../../github/webhook";
import { adminDatabase } from "../../../../lib/workspace-integrations";
import { readWebhookBody } from "../../../../lib/github-webhook";
import { WorkspaceError } from "../../../../lib/workspace-server";
import { enqueuePush, processWebhookJob } from "../../../../lib/webhook-jobs";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  let raw;
  try {
    raw = await readWebhookBody(req);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof WorkspaceError ? error.message : "Invalid payload" },
      { status: error instanceof WorkspaceError ? error.status : 400 },
    );
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const id = payload?.repository?.id;
  if (!Number.isSafeInteger(id))
    return NextResponse.json({ error: "Repository required" }, { status: 400 });
  let connection;
  try {
    const result = await adminDatabase()
      .from("chair_repository_connections")
      .select("workspace_id,webhook_secret,repository")
      .eq("repository_id", id)
      .maybeSingle();
    if (result.error) throw result.error;
    connection = result.data;
  } catch {
    return NextResponse.json(
      { error: "Webhook storage unavailable" },
      { status: 503 },
    );
  }
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
  let jobId:string;
  try { jobId=await enqueuePush(connection.workspace_id,payload); }
  catch(error) {
    return NextResponse.json({error:error instanceof WorkspaceError?error.message:"Code check could not be saved"},
      {status:error instanceof WorkspaceError?error.status:503});
  }
  after(async () => {
    try {
      await processWebhookJob(jobId);
    } catch {
      console.error(
        "[webhook] Saved check awaits scheduled retry.",
      );
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
