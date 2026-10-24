// M7: GitHub push webhook -> changed files -> extract shapes -> diff against contracts -> conflict cards.

import { createHmac, timingSafeEqual } from "node:crypto";
import { agentFromBranch } from "../shared/types";
import type { Conflict } from "../shared/types";
import { extractShapes } from "../analyzer/extract";
import { diffShapes } from "../engine/diff";
import { changedFiles, readFile } from "../server/github";
import { announceConflicts, getContracts, logEvent, postMessage, saveConflicts } from "../server/ledger";

export function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return true; // dev mode: no secret configured
  if (!signature) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP = /^(node_modules|\.next|dist|build|contracts)\/|\.test\.|AGENTS\.md$/;

interface PushPayload {
  ref: string;
  before: string;
  after: string;
  pusher?: { name?: string };
  head_commit?: { message?: string };
}

export async function handlePush(p: PushPayload): Promise<Conflict[]> {
  const branch = p.ref.replace(/^refs\/heads\//, "");
  const agent = agentFromBranch(branch);
  const developer = p.pusher?.name ?? "unknown";

  // Ignore theChair's own commits (contract + AGENTS.md sync) to avoid loops.
  if (p.head_commit?.message?.startsWith("AGENTS.md: sync") || p.head_commit?.message?.startsWith("contracts: ")) {
    return [];
  }

  await logEvent({
    type: "push",
    agent,
    developer,
    branch,
    sha: p.after,
    summary: `${developer} (${agent}) pushed to ${branch}: ${p.head_commit?.message ?? ""}`.trim(),
  });

  const files = (await changedFiles(p.before, p.after)).filter((f) => CODE.test(f) && !SKIP.test(f));
  const contracts = await getContracts();

  const all: Conflict[] = [];
  for (const file of files) {
    const content = await readFile(file, p.after);
    if (!content) continue;
    const { shapes } = await extractShapes(file, content.text, p.after);
    all.push(...diffShapes(shapes, contracts, "webhook").map((c) => ({ ...c, agent, developer })));
  }

  const saved = await saveConflicts(all);
  if (saved.length) await announceConflicts(saved);
  else if (files.length)
    await postMessage({
      author: { type: "system", name: "theChair" },
      kind: "event",
      body: `Checked ${files.length} file(s) from ${branch} against the contracts. All clear.`,
    });
  return saved;
}
