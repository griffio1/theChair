// Shared by POST /api/contracts/propose, the MCP tool and the main chat's propose_contract tool.

import type { Contract, ProposeContractRequest } from "../shared/types";
import { getContract, postMessage, saveContract } from "./ledger";

export async function proposeContract(req: ProposeContractRequest): Promise<Contract> {
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
