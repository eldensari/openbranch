/* ═══════ LLM API — BYOK + Free mode ═══════
 * API 키 있으면 브라우저에서 직접 호출 (BYOK).
 * API 키 없으면 /.netlify/functions/chat 경유 (무료, rate limited).
 */

export function detectProvider(key) {
  if (!key) return null;
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return { id: "anthropic", name: "Anthropic", color: "#D97706" };
  if (k.startsWith("sk-") || k.startsWith("sk-proj-")) return { id: "openai", name: "OpenAI", color: "#10A37F" };
  if (k.startsWith("AI")) return { id: "gemini", name: "Gemini", color: "#4285F4" };
  return null;
}

export const MODEL_CHOICES = {
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

async function callFree(messages, model) {
  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model: model || "claude-sonnet-4-20250514" }),
    signal: AbortSignal.timeout(120000),
  });

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message || "Rate limit reached.");
    err.code = "RATE_LIMIT";
    throw err;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Server error " + res.status);
  }

  const d = await res.json();
  return d.content?.[0]?.text || "";
}

async function callBYOK(apiKey, messages, model, thinking) {
  const key = apiKey.trim().replace(/[^\x20-\x7E]/g, "");
  const provider = detectProvider(key);
  if (!provider) throw new Error("Unknown API key format.");

  const pickModel = (fallback) => model && MODEL_CHOICES[provider.id]?.some(m => m.id === model) ? model : fallback;
  const modelSupportsThinking = MODEL_CHOICES[provider.id]?.find(m => m.id === pickModel(""))?.thinking;

  if (provider.id === "anthropic") {
    const body = { model: pickModel("claude-sonnet-4-20250514"), max_tokens: 16000, messages };
    if (thinking && modelSupportsThinking) body.thinking = { type: "enabled", budget_tokens: 10000 };
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
    // For thinking-enabled responses, find the text block (not the thinking block)
    const textBlock = (d.content || []).find(b => b.type === "text");
    return textBlock?.text || "";
  }

  if (provider.id === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: pickModel("gpt-4o"), max_tokens: 4096, messages }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return d.choices?.[0]?.message?.content || "";
  }

  if (provider.id === "gemini") {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: pickModel("gemini-2.0-flash"), max_tokens: 4096, messages }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return d.choices?.[0]?.message?.content || "";
  }

  throw new Error("Unsupported provider.");
}

export async function callLLM(apiKey, messages, model, thinking) {
  if (apiKey && apiKey.trim()) {
    return callBYOK(apiKey, messages, model, thinking);
  }
  return callFree(messages, model);
}

export async function summarizeThread(apiKey, thread) {
  const conversationText = thread.map(c =>
    "User: " + c.prompt + "\nAssistant: " + (c.response || "(no response)")
  ).join("\n\n");

  const prompt = "Summarize the following conversation in 300 words or less. Focus on key decisions, conclusions, and context that would be useful for continuing the conversation. Use third-person narrative.\n\n---\n\n" + conversationText;
  const messages = [{ role: "user", content: prompt }];

  if (!apiKey || !apiKey.trim()) {
    // Free tier via netlify function — request Haiku model.
    const res = await fetch("/.netlify/functions/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, model: "claude-haiku-4-5" }),
      signal: AbortSignal.timeout(120000),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message || "Rate limit reached.");
      err.code = "RATE_LIMIT";
      throw err;
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

  // OpenAI / Gemini: Haiku is unavailable — fall back to provider's default model via callLLM.
  return callLLM(apiKey, messages);
}

export async function validateKey(key) {
  try {
    await callBYOK(key, [{ role: "user", content: "hello" }]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function submitWaitlist(email) {
  const res = await fetch("/.netlify/functions/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return res.json();
}
