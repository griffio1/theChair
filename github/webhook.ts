// M7: GitHub push webhook -> changed files -> extract shapes -> diff against contracts -> conflict cards.

import { currentWorkspace } from "../server/workspace-context";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { agentFromBranch } from "../shared/types";
import type { Conflict } from "../shared/types";
import { extractShapes } from "../analyzer/extract";
import { diffShapes } from "../engine/diff";
import { changedFiles, readFile, repositoryConnection } from "../server/github";
import { getConflict, getContracts, saveConflicts } from "../server/ledger";
import { insert, select } from "../server/db";

export function verifySignature(
  rawBody: string,
  signature: string | null,
  secret = process.env.GITHUB_WEBHOOK_SECRET,
): boolean {
  if (!secret) return false;
  if (!signature) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// theChair's own source lives in this repo too; only check the product code (e.g. demo/).
const SKIP =
  /^(node_modules|\.next|dist|build|contracts|web|server|engine|mcp|hooks|github|analyzer|shared)\/|\.test\.|AGENTS\.md$/;

interface PushPayload {
  ref: string;
  before: string;
  after: string;
  pusher?: { name?: string };
  head_commit?: { message?: string };
}

// Deterministic UUIDv8 values let the existing primary keys arbitrate retries,
// including concurrent requests on different serverless instances.
function stableId(...parts: unknown[]): string {
  const bytes = createHash("sha256")
    .update(JSON.stringify(["thechair:push:v1", ...parts]))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const duplicateInsert = (error: unknown) =>
  error instanceof Error && / -> 409:/.test(error.message);

async function insertOnce(
  table: "events" | "messages",
  row: Record<string, unknown> & { id: string },
) {
  try {
    await insert(table, row);
  } catch (error) {
    if (!duplicateInsert(error)) throw error;
    // Only ignore a duplicate of this exact row, not an unrelated constraint error.
    const [existing] = await select<{ id: string }>(
      table,
      `id=eq.${row.id}&limit=1`,
    );
    if (!existing) throw error;
  }
}

async function saveConflictOnce(conflict: Conflict): Promise<Conflict> {
  try {
    const [saved] = await saveConflicts([conflict]);
    return saved;
  } catch (error) {
    if (!duplicateInsert(error)) throw error;
    const existing = await getConflict(conflict.id);
    if (!existing) throw error;
    // In particular, never overwrite an approved conflict with status "open".
    return existing;
  }
}

export async function handlePush(p: PushPayload): Promise<Conflict[]> {
  const branch = p.ref.replace(/^refs\/heads\//, "");
  const agent = agentFromBranch(branch);
  const developer = p.pusher?.name ?? "unknown";

  // Ignore theChair's own commits (contract + AGENTS.md sync) to avoid loops.
  if (
    p.head_commit?.message?.startsWith("AGENTS.md: sync") ||
    p.head_commit?.message?.startsWith("contracts: ")
  ) {
    return [];
  }

  const pushId = stableId(currentWorkspace(), p.ref, p.before, p.after);
  await insertOnce("events", {
    id: pushId,
    type: "push",
    agent,
    developer,
    branch,
    sha: p.after,
    summary:
      `${developer} (${agent}) pushed to ${branch}: ${p.head_commit?.message ?? ""}`.trim(),
  });

  const connection = await repositoryConnection();
  const isTheChair =
    connection.repository.toLowerCase() ===
    process.env.GITHUB_REPO?.toLowerCase();
  const genericSkip =
    /(^|\/)(node_modules|\.next|dist|build|\.git)\/|\.test\.|\.spec\.|(^|\/)__tests__\//;
  const files = (await changedFiles(p.before, p.after)).filter(
    (f) =>
      CODE.test(f) && !genericSkip.test(f) && !(isTheChair && SKIP.test(f)),
  );
  const contracts = await getContracts();

  const all: Conflict[] = [];
  for (const file of files) {
    const content = await readFile(file, p.after);
    if (!content) continue;
    const { shapes } = await extractShapes(file, content.text, p.after);
    all.push(
      ...diffShapes(shapes, contracts, "webhook").map((c) => ({
        ...c,
        agent,
        developer,
      })),
    );
  }

  const unique = new Map(
    all.map((conflict) => {
      const id = stableId(
        pushId,
        "conflict",
        conflict.kind,
        conflict.severity,
        conflict.contractId,
        [...conflict.affectedPaths].sort(),
        conflict.summary,
      );
      return [id, { ...conflict, id }] as const;
    }),
  );
  const saved: Conflict[] = [];
  for (const conflict of unique.values()) {
    const row = await saveConflictOnce(conflict);
    saved.push(row);
    // Retry announcements independently: a failed message write must not leave
    // the persisted conflict without a dashboard card after the next delivery.
    await insertOnce("messages", {
      id: stableId(row.id, "announcement"),
      author_type: "system",
      author_name: "theChair",
      kind: "conflict",
      body: row.summary,
      ref_id: row.id,
    });
  }
  if (!saved.length && files.length)
    await insertOnce("messages", {
      id: stableId(pushId, "all-clear"),
      author_type: "system",
      author_name: "theChair",
      kind: "event",
      body: `Checked ${files.length} file(s) from ${branch} against the contracts. All clear.`,
    });
  return saved;
}
