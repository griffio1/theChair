// Shared by POST /api/contracts/propose, the MCP tool and the main chat's propose_contract tool.

import type { Contract, FieldSpec, ProposeContractRequest } from "../shared/types";
import { getContract, postMessage, saveContract } from "./ledger";

export class ProposalInputError extends Error {
  readonly status = 400;
}

const invalid = () => new ProposalInputError("Check the agreement's name, route, and fields before proposing it.");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw invalid();
  return value.trim();
}
function fields(value: unknown): FieldSpec[] {
  if (!Array.isArray(value) || value.length > 100) throw invalid();
  const names = new Set<string>();
  return value.map(field => {
    if (!record(field) || typeof field.name !== "string" ||
      !/^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$/.test(field.name) || names.has(field.name) ||
      !["string","number","boolean","object","array","null","unknown"].includes(field.type as string) ||
      typeof field.required !== "boolean") throw invalid();
    names.add(field.name);
    return {name:field.name,type:field.type as FieldSpec["type"],required:field.required};
  });
}

/** One boundary for HTTP, MCP and model tool calls; reject before touching the ledger. */
export function validateProposal(value: unknown): ProposeContractRequest {
  if (!record(value) || !record(value.contract)) throw invalid();
  const c = value.contract;
  if (typeof c.id !== "string" || c.id.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id) ||
    !["GET","POST","PUT","PATCH","DELETE"].includes(c.method as string) ||
    typeof c.path !== "string" || c.path.length > 1024 || !c.path.startsWith("/") ||
    c.path.includes("//") || /[\s\u0000-\u001f\u007f\\?#]/.test(c.path) ||
    c.path.split("/").some(segment => segment === "." || segment === "..")) throw invalid();
  const contract: ProposeContractRequest["contract"] = {
    id:c.id,name:text(c.name,120),method:c.method as Contract["method"],path:c.path,
    request:fields(c.request),response:fields(c.response),
  };
  if (c.owner !== undefined) contract.owner = text(c.owner,120);
  if (c.notes !== undefined) contract.notes = text(c.notes,4000);
  return {
    contract,proposedBy:text(value.proposedBy,120),
    ...(value.reason !== undefined ? {reason:text(value.reason,2000)} : {}),
  };
}

export async function proposeContract(req: ProposeContractRequest): Promise<Contract> {
  req = validateProposal(req);
  const latest = await getContract(req.contract.id);
  const contract: Contract = {
    ...req.contract,
    version: (latest?.version ?? 0) + 1,
    status: "proposed",
  };
  const saved = await saveContract(contract, req.proposedBy);
  await postMessage({
    author: { type: "ai", name: req.proposedBy },
    kind: "contract_proposal",
    body: req.reason ?? `Proposed ${saved.method} ${saved.path} (${saved.id} v${saved.version}).`,
    refId: `${saved.id}@${saved.version}`,
  });
  return saved;
}
