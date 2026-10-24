// Preflight verdict (used by POST /api/preflight, the MCP tool and the Claude Code hook).

import { randomUUID } from "node:crypto";
import type { Claim, Conflict, Contract, PreflightRequest, PreflightResponse } from "../shared/types";
import { diffShapes, worstSeverity } from "./diff";

export function preflight(
  req: PreflightRequest,
  contracts: Contract[],
  activeClaims: Claim[],
  detectedBy: Conflict["detectedBy"] = "preflight",
): PreflightResponse {
  const conflicts: Conflict[] = diffShapes(req.shapes ?? [], contracts, detectedBy).map((c) => ({
    ...c,
    agent: req.agent,
    developer: req.developer,
  }));

  // File overlap with someone else's live claim: warn, never block.
  const now = Date.now();
  for (const claim of activeClaims) {
    if (claim.developer === req.developer) continue;
    if (Date.parse(claim.expiresAt) < now) continue;
    const overlap = req.paths.filter((p) => claim.paths.some((cp) => pathsOverlap(p, cp)));
    if (overlap.length === 0) continue;
    conflicts.push({
      id: randomUUID(),
      kind: "path_overlap",
      severity: "warn",
      summary: `${claim.developer} (${claim.agent}) is already working on ${overlap.join(", ")}: "${claim.intent}".`,
      suggestedFix: `Coordinate with ${claim.developer} in the main chat before editing these files.`,
      affectedPaths: overlap,
      status: "open",
      detectedBy,
      agent: req.agent,
      developer: req.developer,
      createdAt: new Date().toISOString(),
    });
  }

  const sev = worstSeverity(conflicts);
  const verdict = sev === "block" ? "block" : sev === "warn" ? "warn" : "ok";
  // On a block, only show the fixes that unblock; warnings would just add noise.
  const fixes = conflicts
    .filter((c) => c.suggestedFix && (verdict !== "block" || c.severity === "block"))
    .map((c) => `- ${c.suggestedFix}`);
  return {
    verdict,
    conflicts,
    suggestion: fixes.length ? fixes.join("\n") : undefined,
  };
}

/** Same file, or one path is a directory prefix of the other. */
export function pathsOverlap(a: string, b: string): boolean {
  const na = a.replace(/^\.?\//, "").replace(/\/+$/, "");
  const nb = b.replace(/^\.?\//, "").replace(/\/+$/, "");
  return na === nb || na.startsWith(nb + "/") || nb.startsWith(na + "/");
}
