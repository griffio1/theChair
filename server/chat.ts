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

function systemPrompt(contractsJson: string, notices: string): string {
  return [
    "You are theChair, the main chat for a hackathon team whose members each code with their own AI agent (Claude Code, Codex).",
    "Your job: help the team agree on what they are building, and turn every agreed API shape into a contract with the propose_contract tool.",
    "Rules:",
    "- Reply to the latest human message. The notices below are cards the team already sees on screen; only explain one when someone asks about it.",
    "- Be brief. Plain English, no filler. The team is under time pressure.",
    "- The chat renders markdown: use **bold** for key terms, `code` for fields, paths and files, and \"- \" lists. No tables. Never use emojis.",
    "- Only call propose_contract when the shape is concrete (method, path, field names and types). If something is missing, ask one short question.",
    "- JSON fields are camelCase unless the team explicitly decides otherwise.",
    "- When asked about a conflict, explain what breaks for the user and which file to change. Never invent contracts that are not in the ledger.",
    "- Approval is a human action. Never say a proposal is approved.",
    "",
    "Current approved contracts:",
    contractsJson,
    "",
    "Recent theChair notices (conflict cards, proposals, events):",
    notices || "(none)",
  ].join("\n");
}

/** The team doesn't want emojis in AI replies; models add them anyway. Takes one following space with it. */
export function stripEmoji(s: string): string {
  return s.replace(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\uFE0F\u200D\u20E3]|[\u{E0020}-\u{E007F}])+[ \t]?/gu, "").trim();
}

function toLlm(m: Message): ChatMessage {
  if (m.author.type === "ai") return { role: "assistant", content: m.body };
  return { role: "user", content: `${m.author.name}: ${m.body}` };
}

export async function handleChat(req: ChatRequest, authorUserId?: string): Promise<Message[]> {
  const created: Message[] = [];
  created.push(await postMessage({ author: { type: "human", name: req.author }, kind: "text", body: req.body }, authorUserId));

  const [history, contracts] = await Promise.all([getMessages(30), getContracts()]);
  // System notices go into the system prompt as background, not as chat turns,
  // so the model answers the latest human message instead of the latest card.
  const notices = history
    .filter((m) => m.author.type === "system")
    .map((m) => `- [${m.kind}] ${m.body}`)
    .join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(JSON.stringify(contracts, null, 1), notices) },
    ...history.filter((m) => m.author.type !== "system").map(toLlm),
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
        proposedBy: "theChair AI",
        reason: a.reason,
      });
      created.push({
        id: `${contract.id}@${contract.version}`,
        author: { type: "ai", name: "theChair AI" },
        kind: "contract_proposal",
        body: a.reason,
        refId: `${contract.id}@${contract.version}`,
        createdAt: new Date().toISOString(),
      });
    } catch {
      created.push(
        await postMessage({
          author: { type: "system", name: "theChair" },
          kind: "text",
          body: "Couldn't create that agreement. Try again.",
        }),
      );
    }
  }

  const reply = content ? stripEmoji(content) : "";
  if (reply) {
    created.push(await postMessage({ author: { type: "ai", name: "theChair AI" }, kind: "text", body: reply }));
  }
  return created;
}
