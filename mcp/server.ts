// M5: local MCP server (stdio). Each agent talks to theChair through these three tools.
// Add to Claude Code:  claude mcp add thechair -- npx tsx mcp/server.ts
// Add to Codex:        see README (mcp_servers.thechair in ~/.codex/config.toml)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { AgentName, Contract, ExtractedShape, PreflightResponse } from "../shared/types";

const API = process.env.THECHAIR_API_URL ?? "http://localhost:3000";
const AGENT = (process.env.THECHAIR_AGENT ?? "unknown") as AgentName;
const DEVELOPER = process.env.THECHAIR_DEVELOPER ?? "unknown";

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    signal: AbortSignal.timeout(30000),
    headers: {
      "content-type": "application/json",
      ...(process.env.THECHAIR_AGENT_TOKEN ? { "x-thechair-agent-token": process.env.THECHAIR_AGENT_TOKEN } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`theChair ${method} ${path} -> ${res.status}. Check your connection and access, then try again.`);
  return (await res.json()) as T;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

const server = new McpServer({ name: "thechair", version: "0.1.0" });

server.registerTool(
  "get_contracts",
  {
    description:
      "Get the team's approved API contracts (method, path, request and response fields). Call this at the start of every session and before writing any code that defines or calls an HTTP API.",
    inputSchema: {},
  },
  async () => {
    const contracts = await api<Contract[]>("GET", "/api/contracts");
    return text(JSON.stringify(contracts, null, 2));
  },
);

const shapeInput = z.object({
  role: z.enum(["producer", "consumer"]).describe("producer = defines the endpoint, consumer = calls it"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().describe("e.g. /api/auth/login"),
  file: z.string().describe("file you will write this in"),
  requestFields: z.array(z.string()).describe("body field names sent (consumer) or read (producer)"),
  responseFields: z.array(z.string()).describe("response field names returned (producer) or read (consumer)"),
});

server.registerTool(
  "preflight",
  {
    description:
      "Check your plan against the team's contracts BEFORE editing files. Returns ok, warn or block with a concrete fix. If the verdict is block, do not write the code; apply the fix or ask your developer.",
    inputSchema: {
      intent: z.string().describe("one sentence: what you are about to do"),
      paths: z.array(z.string()).describe("files you will create or edit"),
      shapes: z.array(shapeInput).optional().describe("every HTTP API you will define or call"),
    },
  },
  async ({ intent, paths, shapes }) => {
    const toFields = (names: string[]) => names.map((name) => ({ name, type: "unknown" as const, required: true }));
    const extracted: ExtractedShape[] = (shapes ?? []).map((s) => ({
      file: s.file,
      role: s.role,
      method: s.method,
      path: s.path,
      requestFields: toFields(s.requestFields),
      responseFields: toFields(s.responseFields),
      evidence: [],
    }));
    const r = await api<PreflightResponse>("POST", "/api/preflight", {
      agent: AGENT,
      developer: DEVELOPER,
      intent,
      paths,
      shapes: extracted,
    });
    const lines = [
      `VERDICT: ${r.verdict.toUpperCase()}`,
      ...r.conflicts.map((c) => `- [${c.severity}] ${c.summary}`),
      ...(r.suggestion ? ["", "Fix:", r.suggestion] : []),
    ];
    return text(lines.join("\n"));
  },
);

const fieldInput = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object", "array", "null", "unknown"]),
  required: z.boolean(),
});

server.registerTool(
  "propose_contract_change",
  {
    description:
      "Propose a new API contract or a change to an existing one. It appears in the team's main chat for a human to approve. Do not code against it until it is approved.",
    inputSchema: {
      id: z.string().describe("kebab-case id; reuse an existing id to change that contract"),
      name: z.string(),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string(),
      request: z.array(fieldInput),
      response: z.array(fieldInput),
      reason: z.string().describe("one sentence: why"),
    },
  },
  async ({ reason, ...contract }) => {
    const c = await api<Contract>("POST", "/api/contracts/propose", {
      contract: { ...contract, owner: DEVELOPER },
      proposedBy: `${AGENT} for ${DEVELOPER}`,
      reason,
    });
    return text(`Proposed ${c.id} v${c.version}. Waiting for human approval in the theChair main chat.`);
  },
);

await server.connect(new StdioServerTransport());
