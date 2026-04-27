/* LLM API — BYOK + Free mode, with attachments + web search */

import type {
  Attachment,
  Citation,
  CommitActivityKind,
  CommitActivityStatus,
  ResponseBlock,
} from "@/types";

export type Provider = { id: "anthropic" | "openai" | "gemini"; name: string; color: string };
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};
export type ModelMeta = { id: string; label: string; desc: string; thinking?: boolean };

export type LLMOptions = {
  model?: string | null;
  thinking?: boolean;
  webSearch?: boolean;
  signal?: AbortSignal;
};

function mergeSignals(userSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeout;
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn([timeout, userSignal]);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  timeout.addEventListener("abort", onAbort, { once: true });
  userSignal.addEventListener("abort", onAbort, { once: true });
  if (timeout.aborted || userSignal.aborted) controller.abort();
  return controller.signal;
}

export type LLMResponse = {
  text: string;
  citations?: Citation[];
  blocks?: ResponseBlock[];
};

export type LLMStreamActivity = {
  kind?: CommitActivityKind;
  label: string;
  status?: CommitActivityStatus;
  source?: string;
};

export type LLMStreamHandlers = {
  onText?: (delta: string) => void;
  onActivity?: (activity: LLMStreamActivity) => void;
};

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

type AnthropicTextBlock = { type: "text"; text: string };
type AnthropicImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
};
type AnthropicDocumentBlock = {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
};
type AnthropicUserContent = AnthropicTextBlock | AnthropicImageBlock | AnthropicDocumentBlock;

function anthropicMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant" || !m.attachments?.length) {
      return { role: m.role, content: m.content };
    }
    const content: AnthropicUserContent[] = [];
    for (const a of m.attachments) {
      if (a.type === "image") {
        content.push({
          type: "image",
          source: { type: "base64", media_type: a.mediaType, data: a.data },
        });
      } else if (a.type === "pdf") {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: a.data },
        });
      }
    }
    if (m.content) content.push({ type: "text", text: m.content });
    return { role: m.role, content };
  });
}

function openaiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant" || !m.attachments?.length) {
      return { role: m.role, content: m.content };
    }
    const parts: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > = [];
    for (const a of m.attachments) {
      if (a.type === "image") {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${a.mediaType};base64,${a.data}` },
        });
      }
    }
    if (m.content) parts.push({ type: "text", text: m.content });
    return { role: m.role, content: parts };
  });
}

function geminiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant" || !m.attachments?.length) {
      return { role: m.role, content: m.content };
    }
    const parts: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > = [];
    for (const a of m.attachments) {
      if (a.type === "image") {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${a.mediaType};base64,${a.data}` },
        });
      }
    }
    if (m.content) parts.push({ type: "text", text: m.content });
    return { role: m.role, content: parts };
  });
}

function extractAnthropicText(d: {
  content?: Array<{ type: string; text?: string }>;
}): string {
  if (!d.content) return "";
  const parts: string[] = [];
  for (const b of d.content) {
    if (b.type === "text" && b.text) parts.push(b.text);
  }
  return parts.join("\n\n");
}

function extractAnthropicCitations(d: {
  content?: Array<{
    type: string;
    citations?: Array<{ url?: string; title?: string; cited_text?: string }>;
  }>;
}): Citation[] {
  if (!d.content) return [];
  const out: Citation[] = [];
  const seen = new Set<string>();
  for (const b of d.content) {
    const cits = b.citations || [];
    for (const c of cits) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      out.push({ url: c.url, title: c.title || c.url, snippet: c.cited_text });
    }
  }
  return out;
}

function extractAnthropicBlocks(d: {
  content?: Array<{
    type: string;
    text?: string;
    citations?: Array<{ url?: string; title?: string; cited_text?: string }>;
  }>;
}): ResponseBlock[] | undefined {
  if (!d.content) return undefined;
  const blocks: ResponseBlock[] = [];
  let anyCitations = false;
  for (const b of d.content) {
    if (b.type !== "text" || !b.text) continue;
    const cits: Citation[] = [];
    const seen = new Set<string>();
    for (const c of b.citations || []) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      cits.push({ url: c.url, title: c.title || c.url, snippet: c.cited_text });
    }
    if (cits.length) anyCitations = true;
    blocks.push(cits.length ? { text: b.text, citations: cits } : { text: b.text });
  }
  return anyCitations ? blocks : undefined;
}

type SseEvent = { event: string; data: string };

async function readSse(res: Response, onEvent: (evt: SseEvent) => void | Promise<void>): Promise<void> {
  if (!res.body) throw new Error("Streaming is not supported by this browser.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split(/\r?\n\r?\n/);
    buf = chunks.pop() || "";

    for (const raw of chunks) {
      const lines = raw.split(/\r?\n/);
      let event = "message";
      const data: string[] = [];
      for (const line of lines) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) await onEvent({ event, data: data.join("\n") });
    }
  }

  const tail = buf.trim();
  if (tail) {
    const lines = tail.split(/\r?\n/);
    let event = "message";
    const data: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) await onEvent({ event, data: data.join("\n") });
  }
}

function citationFromAny(c: any): Citation | null {
  const url = c?.url || c?.source_url;
  if (!url) return null;
  return {
    url,
    title: c?.title || c?.document_title || c?.source_title || url,
    snippet: c?.cited_text || c?.content || c?.snippet,
  };
}

function addCitation(out: Citation[], seen: Set<string>, c: any) {
  const cit = citationFromAny(c);
  if (!cit || seen.has(cit.url)) return;
  seen.add(cit.url);
  out.push(cit);
}

async function readAnthropicStream(res: Response, handlers: LLMStreamHandlers = {}): Promise<LLMResponse> {
  const blocks: ResponseBlock[] = [];
  const citations: Citation[] = [];
  const seen = new Set<string>();
  let text = "";
  let anyBlockCitations = false;

  await readSse(res, ({ data }) => {
    if (data === "[DONE]") return;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }

    if (evt.type === "error") {
      throw new Error(evt.error?.message || "Streaming error");
    }

    if (evt.type === "content_block_start") {
      const block = evt.content_block || {};
      if (block.type === "text") {
        blocks[evt.index] = { text: block.text || "" };
        if (block.text) {
          text += block.text;
          handlers.onText?.(block.text);
        }
      }
      if (block.name === "web_search" || block.type === "server_tool_use") {
        handlers.onActivity?.({
          kind: "searching",
          label: "Checking sources",
          status: "running",
          source: "provider",
        });
      }
      return;
    }

    if (evt.type !== "content_block_delta") return;
    const delta = evt.delta || {};
    const idx = evt.index || 0;

    if (delta.type === "text_delta" && delta.text) {
      const block = blocks[idx] || { text: "" };
      block.text += delta.text;
      blocks[idx] = block;
      text += delta.text;
      handlers.onText?.(delta.text);
      return;
    }

    if (delta.type === "citations_delta" && delta.citation) {
      const block = blocks[idx] || { text: "" };
      const blockCitations = block.citations ? [...block.citations] : [];
      const before = citations.length;
      addCitation(citations, seen, delta.citation);
      const added = citations[citations.length - 1];
      if (citations.length > before && added) {
        blockCitations.push(added);
        block.citations = blockCitations;
        blocks[idx] = block;
        anyBlockCitations = true;
      }
    }
  });

  const compactBlocks = blocks.filter(Boolean);
  return {
    text,
    citations,
    blocks: anyBlockCitations ? compactBlocks : undefined,
  };
}

function readOpenAIAnnotations(annotations: any[], citations: Citation[], seen: Set<string>) {
  for (const a of annotations || []) {
    addCitation(citations, seen, a?.url_citation || a);
  }
}

async function readOpenAICompatibleStream(
  res: Response,
  handlers: LLMStreamHandlers = {},
): Promise<LLMResponse> {
  let text = "";
  const citations: Citation[] = [];
  const seen = new Set<string>();

  await readSse(res, ({ data }) => {
    if (data === "[DONE]") return;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }

    if (evt.error) throw new Error(evt.error.message || "Streaming error");

    for (const choice of evt.choices || []) {
      const delta = choice.delta || choice.message || {};
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        handlers.onText?.(delta.content);
      } else if (Array.isArray(delta.content)) {
        for (const part of delta.content) {
          const partText = part?.text || part?.content || "";
          if (typeof partText === "string" && partText) {
            text += partText;
            handlers.onText?.(partText);
          }
        }
      }
      readOpenAIAnnotations(delta.annotations || choice.message?.annotations || [], citations, seen);
    }
  });

  return { text, citations };
}

async function callFree(
  messages: ChatMessage[],
  model: string | null,
  webSearch: boolean,
  userSignal?: AbortSignal,
): Promise<LLMResponse> {
  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: anthropicMessages(messages),
      model: model || "claude-sonnet-4-20250514",
      webSearch: !!webSearch,
    }),
    signal: mergeSignals(userSignal, 120000),
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
  return {
    text: extractAnthropicText(d),
    citations: extractAnthropicCitations(d),
    blocks: extractAnthropicBlocks(d),
  };
}

async function callFreeStream(
  messages: ChatMessage[],
  model: string | null,
  webSearch: boolean,
  userSignal: AbortSignal | undefined,
  handlers: LLMStreamHandlers = {},
): Promise<LLMResponse> {
  const res = await fetch("/.netlify/functions/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: anthropicMessages(messages),
      model: model || "claude-sonnet-4-20250514",
      webSearch: !!webSearch,
      stream: true,
    }),
    signal: mergeSignals(userSignal, 120000),
  });

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    throw new RateLimitError(data.message || "Rate limit reached.");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Server error " + res.status);
  }

  return readAnthropicStream(res, handlers);
}

type AnthropicTool = {
  type: "web_search_20250305";
  name: "web_search";
  max_uses?: number;
};

type AnthropicBody = {
  model: string;
  max_tokens: number;
  messages: ReturnType<typeof anthropicMessages>;
  thinking?: { type: string; budget_tokens: number };
  tools?: AnthropicTool[];
  stream?: boolean;
};

async function callBYOK(
  apiKey: string,
  messages: ChatMessage[],
  opts: LLMOptions = {},
): Promise<LLMResponse> {
  const { model = null, thinking = false, webSearch = false, signal } = opts;
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
      messages: anthropicMessages(messages),
    };
    if (thinking && modelSupportsThinking)
      body.thinking = { type: "enabled", budget_tokens: 10000 };
    if (webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: mergeSignals(signal, 180000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return {
      text: extractAnthropicText(d),
      citations: extractAnthropicCitations(d),
      blocks: extractAnthropicBlocks(d),
    };
  }

  if (provider.id === "openai") {
    const body: Record<string, unknown> = {
      model: pickModel("gpt-4o"),
      max_tokens: 4096,
      messages: openaiMessages(messages),
    };
    if (webSearch) {
      body.tools = [{ type: "web_search" }];
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(body),
      signal: mergeSignals(signal, 180000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    const text: string = d.choices?.[0]?.message?.content || "";
    const annotations = d.choices?.[0]?.message?.annotations || [];
    const citations: Citation[] = [];
    const seen = new Set<string>();
    for (const a of annotations) {
      const url = a?.url_citation?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      citations.push({
        url,
        title: a.url_citation.title || url,
        snippet: a.url_citation.content,
      });
    }
    return { text, citations };
  }

  if (provider.id === "gemini") {
    const body: Record<string, unknown> = {
      model: pickModel("gemini-2.0-flash"),
      max_tokens: 4096,
      messages: geminiMessages(messages),
    };
    if (webSearch) {
      body.tools = [{ google_search: {} }];
    }
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(body),
        signal: mergeSignals(signal, 180000),
      },
    );
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    const d = await res.json();
    return { text: d.choices?.[0]?.message?.content || "" };
  }

  throw new Error("Unsupported provider.");
}

async function callBYOKStream(
  apiKey: string,
  messages: ChatMessage[],
  opts: LLMOptions = {},
  handlers: LLMStreamHandlers = {},
): Promise<LLMResponse> {
  const { model = null, thinking = false, webSearch = false, signal } = opts;
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
      messages: anthropicMessages(messages),
      stream: true,
    };
    if (thinking && modelSupportsThinking)
      body.thinking = { type: "enabled", budget_tokens: 10000 };
    if (webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal: mergeSignals(signal, 180000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    return readAnthropicStream(res, handlers);
  }

  if (provider.id === "openai") {
    const body: Record<string, unknown> = {
      model: pickModel("gpt-4o"),
      max_tokens: 4096,
      messages: openaiMessages(messages),
      stream: true,
    };
    if (webSearch) body.tools = [{ type: "web_search" }];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(body),
      signal: mergeSignals(signal, 180000),
    });
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    return readOpenAICompatibleStream(res, handlers);
  }

  if (provider.id === "gemini") {
    const body: Record<string, unknown> = {
      model: pickModel("gemini-2.0-flash"),
      max_tokens: 4096,
      messages: geminiMessages(messages),
      stream: true,
    };
    if (webSearch) body.tools = [{ google_search: {} }];

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(body),
        signal: mergeSignals(signal, 180000),
      },
    );
    if (!res.ok) throw new Error(res.status === 401 ? "Invalid API key." : "API " + res.status);
    return readOpenAICompatibleStream(res, handlers);
  }

  throw new Error("Unsupported provider.");
}

export async function callLLM(
  apiKey: string,
  messages: ChatMessage[],
  opts: LLMOptions = {},
): Promise<LLMResponse> {
  if (apiKey && apiKey.trim()) {
    return callBYOK(apiKey, messages, opts);
  }
  return callFree(messages, opts.model || null, !!opts.webSearch, opts.signal);
}

export async function callLLMStream(
  apiKey: string,
  messages: ChatMessage[],
  opts: LLMOptions = {},
  handlers: LLMStreamHandlers = {},
): Promise<LLMResponse> {
  if (apiKey && apiKey.trim()) {
    return callBYOKStream(apiKey, messages, opts, handlers);
  }
  return callFreeStream(messages, opts.model || null, !!opts.webSearch, opts.signal, handlers);
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
    return extractAnthropicText(d);
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
    return extractAnthropicText(d);
  }

  const r = await callLLM(apiKey, messages);
  return r.text;
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
