// Main chat (M11). The team talks here; the AI turns agreements into contract proposals
// and explains conflicts. Humans approve proposals with the card's Approve button.

import type { ChatRequest, Message } from "../shared/types";
import { chatCompletion, type ChatMessage, type ToolDef } from "./llm";
import { getContracts, getMessages, postMessage } from "./ledger";
import { proposeContract } from "./propose";

const fieldSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      type: { type: "string", enum: ["string", "number", "boolean", "object", "array", "null", "unknown"] },
      required: { type: "boolean" },
    },
    required: ["name", "type", "required"],
  },
};

const tools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "propose_contract",
      description:
        "Propose a new HTTP API contract, or a new version of an existing one, once the team has agreed on its shape. A human must approve it before agents use it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "kebab-case slug, reuse the existing id to change a contract" },
          name: { type: "string" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string" },
          request: fieldSchema,
          response: fieldSchema,
          owner: { type: "string" },
          reason: { type: "string", description: "one sentence: why this contract or change" },
        },
        required: ["id", "name", "method", "path", "request", "response", "reason"],
      },
    },
  },
];

function systemPrompt(contractsJson: string): string {
  return [
    "You are AgentSync, the main chat for a hackathon team whose members each code with their own AI agent (Claude Code, Codex).",
    "Your job: help the team agree on what they are building, and turn every agreed API shape into a contract with the propose_contract tool.",
    "Rules:",
    "- Be brief. Plain English, no filler. The team is under time pressure.",
    "- Only call propose_contract when the shape is concrete (method, path, field names and types). If something is missing, ask one short question.",
    "- JSON fields are camelCase unless the team explicitly decides otherwise.",
    "- When asked about a conflict, explain what breaks for the user and which file to change. Never invent contracts that are not in the ledger.",
    "- Approval is a human action. Never say a proposal is approved.",
    "",
    "Current approved contracts:",
    contractsJson,
  ].join("\n");
}

function toLlm(m: Message): ChatMessage {
  if (m.author.type === "ai") return { role: "assistant", content: m.body };
  const prefix = m.author.type === "system" ? `[${m.kind}] ` : `${m.author.name}: `;
  return { role: "user", content: prefix + m.body };
}

export async function handleChat(req: ChatRequest): Promise<Message[]> {
  const created: Message[] = [];
  created.push(await postMessage({ author: { type: "human", name: req.author }, kind: "text", body: req.body }));

  const [history, contracts] = await Promise.all([getMessages(30), getContracts()]);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(JSON.stringify(contracts, null, 1)) },
    ...history.map(toLlm),
  ];

  const { content, toolCalls } = await chatCompletion({ messages, tools });

  for (const call of toolCalls) {
    if (call.function.name !== "propose_contract") continue;
    try {
      const a = JSON.parse(call.function.arguments);
      const contract = await proposeContract({
        contract: {
          id: a.id,
          name: a.name,
          method: a.method,
          path: a.path,
          request: a.request ?? [],
          response: a.response ?? [],
          owner: a.owner,
        },
        proposedBy: "AgentSync AI",
        reason: a.reason,
      });
      created.push({
        id: `${contract.id}@${contract.version}`,
        author: { type: "ai", name: "AgentSync AI" },
        kind: "contract_proposal",
        body: a.reason,
        refId: `${contract.id}@${contract.version}`,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      created.push(
        await postMessage({
          author: { type: "system", name: "AgentSync" },
          kind: "text",
          body: `Couldn't create that proposal: ${(e as Error).message}`,
        }),
      );
    }
  }

  if (content && content.trim()) {
    created.push(await postMessage({ author: { type: "ai", name: "AgentSync AI" }, kind: "text", body: content.trim() }));
  }
  return created;
}
