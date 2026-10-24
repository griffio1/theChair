// M9: approving a conflict fix or a proposed contract bumps the ledger and commits
// contracts/<id>.json + AGENTS.md so every agent reads the new truth.

import type { Contract } from "../shared/types";
import { updateAgentsMd } from "../engine/agentsmd";
import {
  getConflict,
  getContract,
  getContracts,
  logEvent,
  postMessage,
  setConflictStatus,
  setContractStatus,
} from "./ledger";
import { readFile, writeFile } from "./github";

async function publish(
  contract: Contract,
  approvedBy: string,
): Promise<string> {
  const all = (await getContracts()).filter((c) => c.id !== contract.id);
  all.push(contract);
  const json = JSON.stringify(contract, null, 2) + "\n";
  await writeFile(
    `contracts/${contract.id}.json`,
    json,
    `contracts: ${contract.id} v${contract.version} (approved by ${approvedBy})`,
  );
  const agents = (await readFile("AGENTS.md"))?.text ?? "# AGENTS.md\n";
  const sha = await writeFile(
    "AGENTS.md",
    updateAgentsMd(agents, all),
    `AGENTS.md: sync contracts after ${contract.id} v${contract.version}`,
  );
  await logEvent({
    type: "approval",
    summary: `${approvedBy} approved ${contract.id} v${contract.version}`,
    sha,
  });
  await postMessage({
    author: { type: "system", name: "theChair" },
    kind: "event",
    body: `Approved ${contract.id} v${contract.version}. AGENTS.md updated; agents get it on their next \`get_contracts\` call or pull.`,
    refId: contract.id,
  });
  return sha;
}

/** Approve a proposed contract version. Supersedes the previous approved version. */
export async function approveContract(
  id: string,
  version: number,
  approvedBy: string,
) {
  const proposed = await getContract(id, version);
  if (!proposed) throw new Error(`No contract ${id} v${version}`);
  const contract = { ...proposed, status: "approved" as const };
  const commitSha = await publish(contract, approvedBy);
  const prev = (await getContracts()).find((c) => c.id === id);
  if (prev && prev.version !== version)
    await setContractStatus(id, prev.version, "superseded");
  await setContractStatus(id, version, "approved");
  return { contract, commitSha };
}

/**
 * Approve a conflict's suggested fix. The fix is "make the code match the contract",
 * so the contract doesn't change; we close the conflict and re-publish so AGENTS.md is fresh.
 * If the team wants the contract to change instead, they propose it in the main chat.
 */
export async function approveConflict(conflictId: string, approvedBy: string) {
  const c = await getConflict(conflictId);
  if (!c) throw new Error(`No conflict ${conflictId}`);
  const contract = c.contractId
    ? (await getContracts()).find((x) => x.id === c.contractId)
    : undefined;
  // Commit first: if GitHub rejects it, the card stays open instead of turning green.
  const commitSha = contract ? await publish(contract, approvedBy) : undefined;
  await setConflictStatus(conflictId, "approved");
  await postMessage({
    author: { type: "system", name: "theChair" },
    kind: "event",
    body: `${approvedBy} approved the fix: ${c.suggestedFix ?? c.summary}`,
    refId: conflictId,
  });
  return { contract, commitSha };
}
