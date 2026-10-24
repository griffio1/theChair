// Deterministic diff engine (M4). Pure functions, no I/O, no LLM.
// Block only on exact contract mismatches. Anything fuzzy is a warning.

import { randomUUID } from "node:crypto";
import type {
  Conflict,
  ConflictKind,
  Contract,
  ExtractedShape,
  FieldSpec,
  HttpMethod,
  Severity,
} from "../shared/types";

/** userId, user_id, UserID, user-id all normalize to "userid". */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, "");
}

/** "/api/users/:id", "/api/users/{id}", "/api/users/${id}" -> "/api/users/:param" */
export function normalizePath(path: string): string {
  let p = path.trim().split("?")[0];
  p = p.replace(/^https?:\/\/[^/]+/, "");
  p = p.replace(/\$\{[^}]+\}|\{[^}]+\}|:[A-Za-z_][A-Za-z0-9_]*/g, ":param");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p.toLowerCase();
}

export function findContract(
  method: HttpMethod,
  path: string,
  contracts: Contract[],
): { contract?: Contract; samePathOtherMethod?: Contract } {
  const np = normalizePath(path);
  const approved = contracts.filter((c) => c.status === "approved");
  const contract = approved.find((c) => c.method === method && normalizePath(c.path) === np);
  if (contract) return { contract };
  const samePathOtherMethod = approved.find((c) => normalizePath(c.path) === np);
  return { samePathOtherMethod };
}

type Draft = Omit<Conflict, "id" | "status" | "createdAt" | "detectedBy">;

function conflict(d: Draft, detectedBy: Conflict["detectedBy"]): Conflict {
  return { ...d, id: randomUUID(), status: "open", createdAt: new Date().toISOString(), detectedBy };
}

function fmt(fields: FieldSpec[]): string {
  return `{ ${fields.map((f) => `${f.name}${f.required ? "" : "?"}: ${f.type}`).join(", ")} }`;
}

/**
 * Compare the fields a piece of code uses against the contract's fields.
 * `side` says which list we're checking and `mustProvide` says whether the code
 * has to include every required contract field (producer response, consumer request)
 * or may only use fields the contract has (producer request, consumer response).
 */
function compareFields(opts: {
  shape: ExtractedShape;
  contract: Contract;
  used: FieldSpec[];
  spec: FieldSpec[];
  mustProvide: boolean;
  label: string; // human description, e.g. "backend response"
  consequence: (missing: string) => string;
}): Draft[] {
  const { shape, contract, used, spec, mustProvide, label } = opts;
  const out: Draft[] = [];
  const specByExact = new Map(spec.map((f) => [f.name, f]));
  const specByNorm = new Map(spec.map((f) => [normalizeName(f.name), f]));
  const usedNames = new Set(used.map((f) => f.name));
  const usedNorm = new Set(used.map((f) => normalizeName(f.name)));
  const base = {
    contractId: contract.id,
    affectedPaths: [shape.file],
    evidence: shape.evidence.map((e) => ({ file: shape.file, ...e })),
  };
  const route = `${contract.method} ${contract.path}`;
  // Cards show the first evidence line, so lead with the lines that mention the field.
  const about = (name: string) => {
    const hit = new RegExp(`\\b${name.replace(/[^A-Za-z0-9_$]/g, "\\$&")}\\b`);
    const ev = base.evidence;
    return { ...base, evidence: [...ev.filter((e) => hit.test(e.snippet)), ...ev.filter((e) => !hit.test(e.snippet))] };
  };

  for (const f of used) {
    const exact = specByExact.get(f.name);
    if (exact) {
      if (exact.type !== "unknown" && f.type !== "unknown" && exact.type !== f.type) {
        out.push({
          ...about(f.name),
          kind: "type_mismatch",
          severity: "block",
          summary: `The ${label} for ${route} uses \`${f.name}\` as ${f.type}, but the contract says ${exact.type}.`,
          suggestedFix: `Make \`${f.name}\` a ${exact.type}, or propose a contract change.`,
        });
      }
      continue;
    }
    const near = specByNorm.get(normalizeName(f.name));
    if (near) {
      out.push({
        ...about(f.name),
        kind: "field_mismatch",
        severity: "block",
        summary: `The ${label} for ${route} uses \`${f.name}\`, but the contract says \`${near.name}\`. ${opts.consequence(near.name)}`,
        suggestedFix: `Rename \`${f.name}\` to \`${near.name}\` (contract ${contract.id} v${contract.version}).`,
      });
      continue;
    }
    // Field not in the contract at all.
    out.push({
      ...about(f.name),
      kind: "extra_field",
      // Reading a field the other side never sends is a real bug; sending an extra one is just noise.
      severity: mustProvide ? "warn" : "block",
      summary: mustProvide
        ? `The ${label} for ${route} includes \`${f.name}\`, which isn't in the contract. Other agents won't know it exists.`
        : `The ${label} for ${route} expects \`${f.name}\`, which the contract doesn't have. It will be undefined.`,
      suggestedFix: `Remove \`${f.name}\`, or propose adding it to contract ${contract.id}.`,
    });
  }

  if (mustProvide) {
    for (const s of spec) {
      if (!s.required) continue;
      if (usedNames.has(s.name)) continue;
      if (usedNorm.has(normalizeName(s.name))) continue; // already reported as field_mismatch
      out.push({
        ...base,
        kind: "missing_field",
        severity: "block",
        summary: `The ${label} for ${route} is missing required field \`${s.name}\`. ${opts.consequence(s.name)}`,
        suggestedFix: `Add \`${s.name}: ${s.type}\`. Contract: ${fmt(spec)}.`,
      });
    }
  }
  return out;
}

export function diffShape(
  shape: ExtractedShape,
  contracts: Contract[],
  detectedBy: Conflict["detectedBy"] = "webhook",
): Conflict[] {
  const { contract, samePathOtherMethod } = findContract(shape.method, shape.path, contracts);
  const evidence = shape.evidence.map((e) => ({ file: shape.file, ...e }));

  if (!contract) {
    if (samePathOtherMethod) {
      return [
        conflict(
          {
            kind: "route_mismatch",
            severity: "block",
            summary: `\`${shape.file}\` uses ${shape.method} ${shape.path}, but the contract says ${samePathOtherMethod.method}. The request will 404 or 405.`,
            suggestedFix: `Use ${samePathOtherMethod.method} ${samePathOtherMethod.path}.`,
            contractId: samePathOtherMethod.id,
            affectedPaths: [shape.file],
            evidence,
          },
          detectedBy,
        ),
      ];
    }
    return [
      conflict(
        {
          kind: "route_mismatch",
          severity: "warn",
          summary: `\`${shape.file}\` uses ${shape.method} ${shape.path}, which has no contract yet. Other agents can't see it.`,
          suggestedFix: `Propose a contract for ${shape.method} ${shape.path} in the main chat.`,
          affectedPaths: [shape.file],
          evidence,
        },
        detectedBy,
      ),
    ];
  }

  const drafts: Draft[] =
    shape.role === "producer"
      ? [
          ...compareFields({
            shape,
            contract,
            used: shape.responseFields,
            spec: contract.response,
            mustProvide: true,
            label: "backend response",
            consequence: (n) => `Anything reading \`${n}\` will get undefined.`,
          }),
          ...compareFields({
            shape,
            contract,
            used: shape.requestFields,
            spec: contract.request,
            mustProvide: false,
            label: "backend request handling",
            consequence: (n) => `Clients send \`${n}\`, so the handler will read undefined.`,
          }),
        ]
      : [
          ...compareFields({
            shape,
            contract,
            used: shape.responseFields,
            spec: contract.response,
            mustProvide: false,
            label: "frontend",
            consequence: (n) => `The backend sends \`${n}\`, so this screen will show undefined.`,
          }),
          ...compareFields({
            shape,
            contract,
            used: shape.requestFields,
            spec: contract.request,
            mustProvide: true,
            label: "frontend request",
            consequence: (n) => `The backend expects \`${n}\` and will reject or mishandle the request.`,
          }),
        ];

  return drafts.map((d) => conflict(d, detectedBy));
}

export function diffShapes(
  shapes: ExtractedShape[],
  contracts: Contract[],
  detectedBy: Conflict["detectedBy"] = "webhook",
): Conflict[] {
  return shapes.flatMap((s) => diffShape(s, contracts, detectedBy));
}

const rank: Record<Severity, number> = { info: 0, warn: 1, block: 2 };

export function worstSeverity(conflicts: Conflict[]): Severity {
  return conflicts.reduce<Severity>((w, c) => (rank[c.severity] > rank[w] ? c.severity : w), "info");
}

export type { ConflictKind };
