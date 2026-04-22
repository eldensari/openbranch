// @ts-nocheck
/* ═══════ DATA ═══════ */
let cc = 100; // start high to avoid conflicts with demo IDs

export function mkId() { return "c" + (++cc) + "_" + Math.random().toString(36).slice(2, 5); }
export function bumpIdCounter(n) { cc = Math.max(cc, n); }

export function shortModelName(id) {
  if (!id) return "";
  if (id.includes("haiku")) return "Haiku";
  if (id.includes("sonnet")) return "Sonnet";
  if (id.includes("opus")) return "Opus";
  if (id === "gpt-4o") return "GPT-4o";
  if (id === "gpt-4o-mini") return "GPT-4o·m";
  if (id.includes("flash")) return "Gemini·F";
  if (id.includes("pro")) return "Gemini·P";
  return id.slice(0, 10);
}

export function mkCommit(parentId, prompt, response, branch, mergeIds = null, model = null) {
  const c = {
    id: mkId(), parentId, mergeIds: mergeIds || [], prompt, response, branch, ts: Date.now(),
  };
  if (model) c.model = model;
  return c;
}

export function buildMsgs(thread, finalUserMsg) {
  const msgs = [];
  for (const c of thread) {
    msgs.push({ role: "user", content: c.prompt });
    if (c.response) msgs.push({ role: "assistant", content: c.response });
  }
  msgs.push({ role: "user", content: finalUserMsg });
  return msgs;
}

export function getThread(commits, hid) {
  const t = []; let id = hid; const v = new Set();
  while (id && !v.has(id)) { v.add(id); const c = commits.find(x => x.id === id); if (!c) break; t.unshift(c); id = c.parentId; }
  return t;
}

export function bNames(c) { return [...new Set(c.map(x => x.branch))]; }
export function bHead(c, b) { const bc = c.filter(x => x.branch === b); return bc.length ? bc[bc.length - 1] : null; }
