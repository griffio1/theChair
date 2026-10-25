// One adapter for every LLM call. Groq, Gemini and Ollama all speak the OpenAI chat-completions format,
// so switching providers is just LLM_PROVIDER=groq|gemini|ollama.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type Provider = "groq" | "gemini" | "ollama";

interface ProviderConfig {
  url: string;
  key?: string;
  model: string;
}

export function providerConfig(provider: Provider = (process.env.LLM_PROVIDER as Provider) ?? "groq"): ProviderConfig {
  switch (provider) {
    case "groq":
      return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        key: process.env.GROQ_API_KEY,
        model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      };
    case "gemini":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        key: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
      };
    case "ollama":
      return {
        url: `${process.env.OLLAMA_URL ?? "http://localhost:11434"}/v1/chat/completions`,
        model: process.env.OLLAMA_MODEL ?? "qwen3:8b",
      };
    default:
      throw new Error("AI provider is not configured correctly.");
  }
}

export async function chatCompletion(opts: {
  messages: ChatMessage[];
  tools?: ToolDef[];
  provider?: Provider;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
}): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const cfg = providerConfig(opts.provider);
  const ctrl = new AbortController();
  const timeout = Number.isFinite(opts.timeoutMs) ? Math.max(1, Math.min(opts.timeoutMs!, 20_000)) : 20_000;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    let res: Response;
    try { res = await fetch(cfg.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.2,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
    }); } catch {
      throw new Error(ctrl.signal.aborted ? "AI reply timed out. Try again." : "AI service could not be reached. Try again.");
    }
    if (!res.ok) throw new Error(`AI service request failed (HTTP ${res.status}). Try again.`);
    let data: any;
    try { data = await res.json(); } catch {
      throw new Error(ctrl.signal.aborted ? "AI reply timed out. Try again." : "AI service returned an unreadable reply. Try again.");
    }
    const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    const msg = choice?.message;
    const calls = msg?.tool_calls ?? [];
    if (!msg || ![null, undefined, "stop", "tool_calls"].includes(choice.finish_reason) ||
        (msg.content !== null && msg.content !== undefined && typeof msg.content !== "string") ||
        !Array.isArray(calls) || calls.some((call: any) => !call || typeof call.id !== "string" || !call.id ||
          call.type !== "function" || typeof call.function?.name !== "string" || !call.function.name ||
          typeof call.function?.arguments !== "string") ||
        (!(typeof msg.content === "string" && msg.content.trim()) && calls.length === 0))
      throw new Error("AI service returned an incomplete reply. Try again.");
    for (const call of calls) {
      if (!opts.tools?.some((tool) => tool.function.name === call.function.name))
        throw new Error("AI service returned an unexpected action. Try again.");
      try { JSON.parse(call.function.arguments); }
      catch { throw new Error("AI service returned an incomplete action. Try again."); }
    }
    return { content: msg.content ?? null, toolCalls: calls };
  } finally {
    clearTimeout(timer);
  }
}
