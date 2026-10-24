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
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(cfg.url, {
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
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
    };
    const msg = data.choices[0]?.message;
    return { content: msg?.content ?? null, toolCalls: msg?.tool_calls ?? [] };
  } finally {
    clearTimeout(timer);
  }
}
