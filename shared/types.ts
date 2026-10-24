// theChair shared interface (M1). FROZEN: changes need both builders' approval + a DECISIONS.md entry.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** JSON-ish field type. Keep it small: the diff engine only compares these. */
export type FieldType = "string" | "number" | "boolean" | "object" | "array" | "null" | "unknown";

export interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
}

export type ContractStatus = "proposed" | "approved" | "superseded";

/** One agreed HTTP API shape. The ledger is a list of these. */
export interface Contract {
  id: string; // stable slug, e.g. "auth-login"
  name: string;
  method: HttpMethod;
  path: string; // "/api/auth/login"
  request: FieldSpec[];
  response: FieldSpec[];
  version: number;
  status: ContractStatus;
  owner?: string; // developer who owns the producer side
  notes?: string;
}

/** What the extractor (B) finds in a changed file. Consumed by the diff engine (A). */
export interface ExtractedShape {
  file: string;
  role: "producer" | "consumer"; // backend handler vs frontend call
  method: HttpMethod;
  path: string;
  /** For a producer: fields it returns. For a consumer: fields it reads from the response. */
  responseFields: FieldSpec[];
  /** For a producer: fields it reads from the body. For a consumer: fields it sends. */
  requestFields: FieldSpec[];
  evidence: { line: number; snippet: string }[];
}

export type Verdict = "ok" | "warn" | "block";

export interface PreflightRequest {
  agent: AgentName;
  developer: string;
  intent: string; // free text: what the agent is about to do
  paths: string[]; // files it will touch
  /** Optional: shapes declared by the agent, or extracted by the hook from the proposed edit. */
  shapes?: ExtractedShape[];
}

export interface PreflightResponse {
  verdict: Verdict;
  conflicts: Conflict[];
  suggestion?: string;
}

export type ConflictKind =
  | "field_mismatch" // userId vs user_id
  | "missing_field"
  | "extra_field"
  | "type_mismatch"
  | "route_mismatch" // method or path differs from any contract
  | "path_overlap" // two agents claiming the same file
  | "duplicate_work";

export type Severity = "info" | "warn" | "block";

export interface Conflict {
  id: string;
  kind: ConflictKind;
  severity: Severity;
  summary: string; // plain English, with consequence
  contractId?: string;
  affectedPaths: string[];
  suggestedFix?: string;
  status: "open" | "approved" | "dismissed";
  detectedBy: "preflight" | "webhook" | "hook";
  agent?: AgentName;
  developer?: string;
  evidence?: { file: string; line: number; snippet: string }[];
  createdAt: string;
}

export type AgentName = "claude-code" | "codex" | "cursor" | "gemini-cli" | "human" | "unknown";

export interface Claim {
  id: string;
  agent: AgentName;
  developer: string;
  paths: string[];
  intent: string;
  createdAt: string;
  expiresAt: string;
}

/** Main chat. Everything the team agrees on flows through here. */
export type MessageKind = "text" | "contract_proposal" | "conflict" | "event";

export interface Message {
  id: string;
  author: { type: "human" | "ai" | "system"; name: string };
  kind: MessageKind;
  body: string;
  /** "<contractId>@<version>" for contract_proposal, conflict id for conflict, free-form for event */
  refId?: string;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  type: "push" | "pull_request" | "preflight" | "approval" | "contract_change";
  agent?: AgentName;
  developer?: string;
  branch?: string;
  sha?: string;
  summary: string;
  createdAt: string;
}

// ---- Routes (A builds, B calls) ----
export const ROUTES = {
  preflight: "POST /api/preflight", // PreflightRequest -> PreflightResponse
  contracts: "GET /api/contracts", // -> Contract[] (approved only unless ?all=1)
  propose: "POST /api/contracts/propose", // ProposeContractRequest -> Contract
  webhook: "POST /api/github/webhook", // GitHub push/pull_request payload -> 202
  approve: "POST /api/conflicts/:id/approve", // -> { contract, commitSha }
  approveContract: "POST /api/contracts/:id/approve", // -> { contract, commitSha }
  chat: "POST /api/chat", // ChatRequest -> Message[] (new messages)
} as const;

export interface ProposeContractRequest {
  contract: Omit<Contract, "version" | "status">;
  proposedBy: string;
  reason?: string;
}

export interface ChatRequest {
  author: string;
  body: string;
}

/** Branch naming convention: agent/<tool>/<topic> */
export function agentFromBranch(branch: string): AgentName {
  const m = /^(?:refs\/heads\/)?agent\/([^/]+)\//.exec(branch);
  if (!m) return "unknown";
  const tool = m[1];
  const known: AgentName[] = ["claude-code", "codex", "cursor", "gemini-cli"];
  return (known as string[]).includes(tool) ? (tool as AgentName) : "unknown";
}
