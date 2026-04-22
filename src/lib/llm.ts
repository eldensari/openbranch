/* ═══════ LLM API — BYOK + Free mode ═══════ */

export type Provider = { id: "anthropic" | "openai" | "gemini"; name: string; color: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ModelMeta = { id: string; label: string; desc: string; thinking?: boolean };

class RateLimitError extends Error {
  code = "RATE_LIMIT" as const;
  constructor(msg: string) {
    super(msg);
  }
}

export function detectProvider(key: string | null | undefined): Provider | null {
  if (!key) return null;
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return { id: "anthropic", name: "Anthropic", color: "#D97706" };
  if (k.startsWith("sk-") || k.startsWith("sk-proj-"))
    return { id: "openai", name: "OpenAI", color: "#10A37F" };
  if (k.startsWith("AI")) return { id: "gemini", name: "Gemini", color: "#4285F4" };
  return null;
}

export const MODEL_CHOICES: Record<string, ModelMeta[]> = {
  anthropic: [
    { id: "claude-opus-4-20250514", label: "Opus 4", desc: "Most capable for ambitious work", thinking: true },
    { id: "claude-sonnet-4-20250514", label: "Sonnet 4", desc: "Most efficient for everyday tasks", thinking: true },
    { id: "claude-haiku-4-5", label: "Haiku 4.5", desc: "Fastest for quick answers" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o", desc: "Most capable" },
    { id: "gpt-4o-mini", label: "GPT-4o mini", desc: "Faster, cheaper" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", desc: "Fast responses" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", desc: "Higher capability" },
  ],
  free: [{ id: "claude-sonnet-4-20250514", label: "Sonnet 4", desc: "Free tier", thinking: true }],
};

async function callFree(messages: ChatMessage[], model: string | null): Promise<string> {
  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model: model || "claude-sonnet-4-20250514" }),
    signal: AbortSignal.timeout(120000),
  });

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    throw new RateLimitError(data.message || "Rate limit reached.");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Server error " + res.status);
  }

  const d = await res.json();
  return d.content?.[0]?.text || "";
}

type AnthropicBody = {
  model: string;
  max_tokens: number;
  messages: ChatMessage[];
  thinking?: { type: string; budget_tokens: number };
};

async function callBYOK(
  apiKey: string,
  messages: ChatMessage[],
  model: string | null = null,
  thinking: boolean = false,
): Promise<string> {
  const key = apiKey.trim().replace(/[^\x20-\x7E]/g, "");
  const provider = detectProvider(key);
  if (!provider) throw new Error("Unknown API key format.");

  const pickModel = (fallback: string) =>
    model && MODEL_CHOICES[provider.id]?.some((m) => m.id === model) ? model : fallback;
  const modelSupportsThinking = MODEL_CHOICES[provider.id]?.find(
    (m) => m.id === pickModel(""),
  )?.thinking;

  if (provider.id === "anthropic") {
    const body: AnthropicBody = {
      model: pickModel("claude-sonnet-4-20250514"),
      max_tokens: 16000,
      messages,
    };
    if (thinking && modelSupportsThinking)
      body.thinking = { type: "enabled", budget_tokens: 10000 };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    const textBlock = (d.content || []).find((b: { type: string }) => b.type === "text");
    return textBlock?.text || "";
  }

  if (provider.id === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ model: pickModel("gpt-4o"), max_tokens: 4096, messages }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return d.choices?.[0]?.message?.content || "";
  }

  if (provider.id === "gemini") {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model: pickModel("gemini-2.0-flash"), max_tokens: 4096, messages }),
        signal: AbortSignal.timeout(120000),
      },
    );
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return d.choices?.[0]?.message?.content || "";
  }

  throw new Error("Unsupported provider.");
}

export async function callLLM(
  apiKey: string,
  messages: ChatMessage[],
  model: string | null = null,
  thinking: boolean = false,
): Promise<string> {
  if (apiKey && apiKey.trim()) {
    return callBYOK(apiKey, messages, model, thinking);
  }
  return callFree(messages, model);
}

type ThreadCommit = { prompt: string; response?: string };

export async function summarizeThread(apiKey: string, thread: ThreadCommit[]): Promise<string> {
  const conversationText = thread
    .map((c) => "User: " + c.prompt + "\nAssistant: " + (c.response || "(no response)"))
    .join("\n\n");

  const prompt =
    "Summarize the following conversation in 300 words or less. Focus on key decisions, conclusions, and context that would be useful for continuing the conversation. Use third-person narrative.\n\n---\n\n" +
    conversationText;
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];

  if (!apiKey || !apiKey.trim()) {
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: "claude-haiku-4-5" }),
      signal: AbortSignal.timeout(120000),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      throw new RateLimitError(data.message || "Rate limit reached.");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Server error " + res.status);
    }
    const d = await res.json();
    return d.content?.[0]?.text || "";
  }

  const key = apiKey.trim().replace(/[^\x20-\x7E]/g, "");
  const provider = detectProvider(key);
  if (provider?.id === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1024, messages }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return d.content?.[0]?.text || "";
  }

  return callLLM(apiKey, messages);
}

export async function validateKey(key: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await callBYOK(key, [{ role: "user", content: "hello" }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function submitWaitlist(email: string): Promise<{ ok?: boolean; [k: string]: unknown }> {
  const res = await fetch("/.netlify/functions/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return res.json();
}
