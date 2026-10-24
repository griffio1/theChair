// POST /api/preflight handler: loads the ledger, runs the engine, records claim + conflicts.

import type { PreflightRequest, PreflightResponse } from "../shared/types";
import { preflight } from "../engine/preflight";
import { announceConflicts, getActiveClaims, getContracts, logEvent, saveClaim, saveConflicts } from "./ledger";

export async function runPreflight(
  req: PreflightRequest,
  detectedBy: "preflight" | "hook" = "preflight",
): Promise<PreflightResponse> {
  const [contracts, claims] = await Promise.all([getContracts(), getActiveClaims()]);
  const result = preflight(req, contracts, claims, detectedBy);

  await logEvent({
    type: "preflight",
    agent: req.agent,
    developer: req.developer,
    summary: `${req.developer} (${req.agent}) preflight: ${result.verdict} — ${req.intent}`,
  });
  if (req.paths.length) await saveClaim({ agent: req.agent, developer: req.developer, paths: req.paths, intent: req.intent });

  // Only surface blocks and real warnings in the chat; path overlaps are noisy, keep them on the card list.
  const worth = result.conflicts.filter((c) => c.severity === "block" || c.kind !== "path_overlap");
  if (worth.length) {
    const saved = await saveConflicts(worth);
    await announceConflicts(saved);
  }
  return result;
}
