// Ledger access: maps DB rows (snake_case) to shared types (camelCase).

import type { ActivityEvent, Claim, Conflict, Contract, Message } from "../shared/types";
import { insert, select, update } from "./db";

type Row = Record<string, any>;

const toContract = (r: Row): Contract => ({
  id: r.id,
  name: r.name,
  method: r.method,
  path: r.path,
  request: r.request,
  response: r.response,
  version: r.version,
  status: r.status,
  owner: r.owner ?? undefined,
  notes: r.notes ?? undefined,
});

/** Latest approved version of every contract (or every row when all=true). */
export async function getContracts(all = false): Promise<Contract[]> {
  const rows = await select<Row>("contracts", all ? "order=id,version.desc" : "status=eq.approved&order=id,version.desc");
  if (all) return rows.map(toContract);
  const latest = new Map<string, Contract>();
  for (const r of rows) if (!latest.has(r.id)) latest.set(r.id, toContract(r));
  return [...latest.values()];
}

export async function getContract(id: string, version?: number): Promise<Contract | undefined> {
  const q = version ? `id=eq.${encodeURIComponent(id)}&version=eq.${version}` : `id=eq.${encodeURIComponent(id)}&order=version.desc&limit=1`;
  const [r] = await select<Row>("contracts", q);
  return r ? toContract(r) : undefined;
}

export async function saveContract(c: Contract, proposedBy?: string): Promise<Contract> {
  const [r] = await insert<Row>("contracts", {
    id: c.id,
    version: c.version,
    name: c.name,
    method: c.method,
    path: c.path,
    request: c.request,
    response: c.response,
    status: c.status,
    owner: c.owner ?? null,
    notes: c.notes ?? null,
    proposed_by: proposedBy ?? null,
  });
  return toContract(r);
}

export async function setContractStatus(id: string, version: number, status: Contract["status"]) {
  await update("contracts", `id=eq.${encodeURIComponent(id)}&version=eq.${version}`, { status });
}

export async function getActiveClaims(): Promise<Claim[]> {
  const rows = await select<Row>("claims", `expires_at=gt.${new Date().toISOString()}`);
  return rows.map((r) => ({
    id: r.id,
    agent: r.agent,
    developer: r.developer,
    paths: r.paths,
    intent: r.intent,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

export async function saveClaim(c: Pick<Claim, "agent" | "developer" | "paths" | "intent">) {
  await insert("claims", c);
}

const conflictRow = (c: Conflict) => ({
  id: c.id,
  kind: c.kind,
  severity: c.severity,
  summary: c.summary,
  contract_id: c.contractId ?? null,
  affected_paths: c.affectedPaths,
  suggested_fix: c.suggestedFix ?? null,
  status: c.status,
  detected_by: c.detectedBy,
  agent: c.agent ?? null,
  developer: c.developer ?? null,
  evidence: c.evidence ?? [],
});

const toConflict = (r: Row): Conflict => ({
  id: r.id,
  kind: r.kind,
  severity: r.severity,
  summary: r.summary,
  contractId: r.contract_id ?? undefined,
  affectedPaths: r.affected_paths,
  suggestedFix: r.suggested_fix ?? undefined,
  status: r.status,
  detectedBy: r.detected_by,
  agent: r.agent ?? undefined,
  developer: r.developer ?? undefined,
  evidence: r.evidence,
  createdAt: r.created_at,
});

export async function saveConflicts(cs: Conflict[]): Promise<Conflict[]> {
  if (cs.length === 0) return [];
  return (await insert<Row>("conflicts", cs.map(conflictRow))).map(toConflict);
}

export async function getConflict(id: string): Promise<Conflict | undefined> {
  const [r] = await select<Row>("conflicts", `id=eq.${id}`);
  return r ? toConflict(r) : undefined;
}

export async function setConflictStatus(id: string, status: Conflict["status"]) {
  await update("conflicts", `id=eq.${id}`, { status });
}

export async function getMessages(limit = 30): Promise<Message[]> {
  const rows = await select<Row>("messages", `order=created_at.desc&limit=${limit}`);
  return rows.reverse().map((r) => ({
    id: r.id,
    author: { type: r.author_type, name: r.author_name },
    kind: r.kind,
    body: r.body,
    refId: r.ref_id ?? undefined,
    createdAt: r.created_at,
  }));
}

export async function postMessage(m: Omit<Message, "id" | "createdAt">): Promise<Message> {
  const [r] = await insert<Row>("messages", {
    author_type: m.author.type,
    author_name: m.author.name,
    kind: m.kind,
    body: m.body,
    ref_id: m.refId ?? null,
  });
  return { ...m, id: r.id, createdAt: r.created_at };
}

export async function logEvent(e: Omit<ActivityEvent, "id" | "createdAt">) {
  await insert("events", e);
}

/** Post each conflict into the main chat as a card. */
export async function announceConflicts(cs: Conflict[]) {
  for (const c of cs) {
    await postMessage({
      author: { type: "system", name: "theChair" },
      kind: "conflict",
      body: c.summary,
      refId: c.id,
    });
  }
}
