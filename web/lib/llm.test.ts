import test from "node:test";
import assert from "node:assert/strict";
import { chatCompletion } from "../../server/llm";

const options = { messages: [{ role: "user" as const, content: "Hello" }], provider: "ollama" as const };
test("AI completion accepts text and structured tool calls", async (t) => {
  const call = { id: "call-1", type: "function", function: { name: "propose", arguments: "{}" } };
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [call] } }] }));
  assert.deepEqual(await chatCompletion({ ...options, tools: [{ type: "function", function: { name: "propose", description: "Propose", parameters: {} } }] }), { content: null, toolCalls: [call] });
});

for (const [label, body] of Object.entries({
  missing: {}, empty: { choices: [] }, blank: { choices: [{ message: { content: " " } }] },
  wrongType: { choices: [{ message: { content: { error: "private" } } }] },
  truncated: { choices: [{ finish_reason: "length", message: { content: "partial" } }] },
  badTool: { choices: [{ message: { content: null, tool_calls: [{ id: "call", type: "function", function: { name: "propose", arguments: {} } }] } }] },
})) test(`AI rejects ${label} replies instead of silently succeeding`, async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(body));
  await assert.rejects(chatCompletion(options), /incomplete reply/);
});

test("AI errors never include raw provider or network details", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response("private-provider-data", { status: 429 }));
  await assert.rejects(chatCompletion(options), (error: any) => /HTTP 429/.test(error.message) && !error.message.includes("private"));
  mock.mock.mockImplementation(async () => new Response("private-invalid-json"));
  await assert.rejects(chatCompletion(options), /unreadable reply/);
  mock.mock.mockImplementation(async () => { throw new Error("private-network-data"); });
  await assert.rejects(chatCompletion(options), /could not be reached/);
});

test("AI cancels a stalled request at its deadline", async (t) => {
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));
  await assert.rejects(chatCompletion({ ...options, timeoutMs: 5 }), /timed out/);
});

test("AI rejects unrequested actions and malformed arguments without exposing provider output", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: null,
    tool_calls: [{ id: "call", type: "function", function: { name: "propose", arguments: "private-incomplete-json" } }],
  } }] }));
  await assert.rejects(chatCompletion(options), /unexpected action/);
  await assert.rejects(chatCompletion({ ...options, tools: [{ type: "function", function: { name: "propose", description: "Propose", parameters: {} } }] }), /incomplete action/);
});
