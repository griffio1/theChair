import { randomUUID } from "node:crypto";
import type { Contract } from "../shared/types";
import { updateAgentsMd } from "../engine/agentsmd";
import { getContracts } from "./ledger";
import { publishFilesAtomically, readFile } from "./github";
import { currentWorkspace } from "./workspace-context";

export class ApprovalError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

interface ApprovalJob {
  operation_key: string;
  status: "pending" | "complete" | "cancelled";
  contract: Contract | null;
  approved_by: string;
  branch: string | null;
  base_sha: string | null;
  candidate_sha: string | null;
  commit_sha: string | null;
}

async function approvalRpc<T = ApprovalJob>(name: string, params: Record<string, unknown>): Promise<T> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new ApprovalError(503, "Approval storage is unavailable.");
  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_workspace: currentWorkspace(), ...params }),
    });
  } catch {
    throw new ApprovalError(503, "Approval storage did not respond. Retry this approval.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (["42P01", "42883", "PGRST202"].includes(body?.code))
      throw new ApprovalError(503, "Approval setup is missing. Run approval-publishing.sql.");
    if (body?.code === "55P03") throw new ApprovalError(409,
      body?.message === "Finish the pending approval before approving another change"
        ? "Finish the pending approval before approving another change."
        : "Approval is running. Retry shortly.");
    if (body?.code === "40001") throw new ApprovalError(409, "The agreement or saved publication changed. Review this approval before retrying.");
    if (body?.code === "P0002") throw new ApprovalError(404, "Agreement or issue unavailable.");
    if (body?.code === "22023") throw new ApprovalError(400, "Invalid approval.");
    throw new ApprovalError(503, "Approval could not be saved. Retry this approval.");
  }
  if (body === null && name !== "chair_release_approval")
    throw new ApprovalError(503, "Approval result was not confirmed. Retry this approval.");
  return body as T;
}

async function approve(kind: "contract" | "conflict", id: string, version: number | null, approvedBy: string) {
  const lease = randomUUID();
  let job = await approvalRpc("chair_take_approval", {
    p_kind: kind, p_id: id, p_version: version, p_approved_by: approvedBy, p_lease: lease,
  });
  if (job.status === "complete") return job;
  const fence = { p_key: job.operation_key, p_lease: lease };
  try {
    const contract = job.contract;
    const commitSha = contract ? await publishFilesAtomically({
      message: `contracts: ${contract.id} v${contract.version} (approved by ${job.approved_by})`,
      pending: job.branch && job.base_sha && job.candidate_sha
        ? { branch: job.branch, baseSha: job.base_sha, sha: job.candidate_sha } : undefined,
      files: async (head, signal) => {
        // Re-read on every ref retry. Preserve unrelated AGENTS.md edits and
        // refuse to replace an agreement already newer in either store.
        const all = await getContracts();
        if (all.some((c) => c.id === contract.id && c.version > contract.version))
          throw new ApprovalError(409, "A newer agreement is already approved.");
        const path = `contracts/${contract.id}.json`;
        const existing = await readFile(path, head, signal);
        if (existing) {
          let published: unknown;
          try { published = JSON.parse(existing.text); }
          catch { throw new ApprovalError(409, "The agreement file needs review before publishing."); }
          if (!published || typeof published !== "object" || !("version" in published) || !Number.isInteger(published.version))
            throw new ApprovalError(409, "The agreement file needs review before publishing.");
          if ((published.version as number) > contract.version)
            throw new ApprovalError(409, "GitHub already has a newer agreement.");
        }
        const agents = (await readFile("AGENTS.md", head, signal))?.text ?? "# AGENTS.md\n";
        return [
          { path, content: JSON.stringify(contract, null, 2) + "\n" },
          { path: "AGENTS.md", content: updateAgentsMd(agents, [...all.filter((c) => c.id !== contract.id), contract]) },
        ];
      },
      recordCandidate: async (candidate) => {
        job = await approvalRpc("chair_stage_approval", { ...fence, p_candidate: candidate });
      },
      discardCandidate: async (sha) => {
        job = await approvalRpc("chair_stage_approval", { ...fence, p_candidate: null, p_clear_sha: sha });
      },
    }) : undefined;
    // Statuses, the event, the chat notice, and the replayable result commit in
    // one database transaction only after the GitHub ref is confirmed.
    return await approvalRpc("chair_finish_approval", { ...fence, p_commit_sha: commitSha ?? null });
  } catch (error) {
    // A surviving request can be retried immediately. A crashed process instead
    // leaves a two-minute lease; its saved commit is recovered on the next try.
    await approvalRpc("chair_release_approval", fence).catch(() => {});
    throw error;
  }
}

export async function approveContract(id: string, version: number, approvedBy: string) {
  const job = await approve("contract", id, version, approvedBy);
  return { contract: job.contract!, commitSha: job.commit_sha! };
}

export async function approveConflict(conflictId: string, approvedBy: string) {
  const job = await approve("conflict", conflictId, null, approvedBy);
  return { contract: job.contract ?? undefined, commitSha: job.commit_sha ?? undefined };
}
