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

async function callFree(messages) {
  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model: "claude-sonnet-4-20250514" }),
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

async function callBYOK(apiKey, messages) {
  const key = apiKey.trim().replace(/[^\x20-\x7E]/g, "");
  const provider = detectProvider(key);
  if (!provider) throw new Error("Unknown API key format.");

  if (provider.id === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, messages }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return d.content?.[0]?.text || "";
  }

  if (provider.id === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: "gpt-4o", max_tokens: 4096, messages }),
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
      body: JSON.stringify({ model: "gemini-2.0-flash", max_tokens: 4096, messages }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return d.choices?.[0]?.message?.content || "";
  }

  throw new Error("Unsupported provider.");
}

export async function callLLM(apiKey, messages) {
  if (apiKey && apiKey.trim()) {
    return callBYOK(apiKey, messages);
  }
  return callFree(messages);
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
