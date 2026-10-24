// Rewrites the contracts section of AGENTS.md (used by the approve route, M9).

import type { Contract, FieldSpec } from "../shared/types";

const START = "<!-- AGENTSYNC:CONTRACTS:START -->";
const END = "<!-- AGENTSYNC:CONTRACTS:END -->";

function fields(fs: FieldSpec[]): string {
  return `{ ${fs.map((f) => `${f.name}${f.required ? "" : "?"}: ${f.type}`).join(", ")} }`;
}

export function renderContracts(contracts: Contract[]): string {
  const approved = contracts
    .filter((c) => c.status === "approved")
    .sort((a, b) => a.path.localeCompare(b.path));
  if (approved.length === 0) return "_No approved contracts yet._";
  return approved
    .map(
      (c) =>
        `- \`${c.method} ${c.path}\` (${c.id} v${c.version}): request \`${fields(c.request)}\` → response \`${fields(c.response)}\``,
    )
    .join("\n");
}

export function updateAgentsMd(current: string, contracts: Contract[]): string {
  const block = `${START}\n${renderContracts(contracts)}\n${END}`;
  const s = current.indexOf(START);
  const e = current.indexOf(END);
  if (s === -1 || e === -1 || e < s) {
    return `${current.trimEnd()}\n\n## Current contracts\n${block}\n`;
  }
  return current.slice(0, s) + block + current.slice(e + END.length);
}
