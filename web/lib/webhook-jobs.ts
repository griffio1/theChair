import { createHash, timingSafeEqual } from "node:crypto";
import { handlePush } from "../../github/webhook";
import { repositoryConnection } from "../../server/github";
import { inWorkspace } from "../../server/workspace-context";
import { adminDatabase } from "./workspace-integrations";
import { consumeWorkspaceBudget } from "./production-limits";
import { WorkspaceError } from "./workspace-server";

export function schedulerAuthorized(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function enqueuePush(workspaceId: string, payload: any): Promise<string> {
  // Store only the metadata used by the checker, never the raw signed body.
  const safe = {
    ref: payload.ref, before: payload.before, after: payload.after,
    repository: { id: payload.repository.id },
    pusher: { name: typeof payload.pusher?.name === "string" ? payload.pusher.name.slice(0,100) : "unknown" },
    head_commit: { message: typeof payload.head_commit?.message === "string" ? payload.head_commit.message.slice(0,1000) : "" },
  };
  const delivery = createHash("sha256").update(JSON.stringify([safe.repository.id,safe.ref,safe.before,safe.after])).digest("hex");
  const result = await adminDatabase().rpc("chair_enqueue_webhook", {
    p_workspace: workspaceId, p_delivery: delivery, p_payload: safe,
  });
  if (result.error?.code === "P0001") throw new WorkspaceError(429,"Too many code checks. Retry this delivery later.");
  if (result.error || typeof result.data !== "string") throw new WorkspaceError(503,"Code checks could not be saved. Retry this delivery.");
  return result.data;
}

type Job = { id: string; workspace_id: string; lease_token: string; payload: Parameters<typeof handlePush>[0] & {repository:{id:number}} };
export async function processWebhookJob(id?: string): Promise<{processed:number;failed:number}> {
  const db = adminDatabase();
  const claimed = await db.rpc("chair_claim_webhook", {p_id:id ?? null});
  if (claimed.error) throw new WorkspaceError(503,"Code checks are unavailable. Try again.");
  const job = claimed.data as Job | null;
  if (!job) return {processed:0,failed:0};
  let ok=false, retryAfter=0;
  try {
    await inWorkspace(job.workspace_id, async () => {
      const connection=await repositoryConnection();
      if (connection.repository_id!==job.payload.repository.id) throw new Error("Repository changed");
      await handlePush(job.payload, {
        signal: AbortSignal.timeout(240000),
        beforeExtract: () => consumeWorkspaceBudget(job.workspace_id,connection.connected_by,"extraction"),
      });
    });
    ok=true;
  } catch (error) {
    if ((error instanceof WorkspaceError && error.status===429) ||
        (error instanceof Error && /(?:-> 429\b|\bPT429\b)/.test(error.message))) retryAfter=86400;
    // Identifiers only: no source code, payloads, tokens or provider replies.
    console.error("[webhook] Check failed", {jobId:job.id,workspaceId:job.workspace_id});
  }
  const finished=await db.rpc("chair_finish_webhook",{p_id:job.id,p_lease:job.lease_token,p_ok:ok,p_retry_after:retryAfter});
  if (finished.error || finished.data!==true) throw new WorkspaceError(503,"Code check status could not be saved.");
  return {processed:ok?1:0,failed:ok?0:1};
}
