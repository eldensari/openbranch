import type { Attachment, Citation, Commit, CommitActivity, CommitId, ResponseBlock } from "@/types";

/* ═══════ DATA ═══════ */
let cc = 100; // start high to avoid conflicts with demo IDs

export function mkId(): string {
  return "c" + (++cc) + "_" + Math.random().toString(36).slice(2, 5);
}
export function bumpIdCounter(n: number): void {
  cc = Math.max(cc, n);
}

export function shortModelName(id: string | undefined | null): string {
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

export function mkCommit(
  parentId: CommitId | null,
  prompt: string,
  response: string,
  branch: string,
  mergeIds: CommitId[] | null = null,
  model: string | null = null,
  extras?: {
    attachments?: Attachment[];
    citations?: Citation[];
    responseBlocks?: ResponseBlock[];
    activities?: CommitActivity[];
    webSearch?: boolean;
  },
): Commit {
  const c: Commit = {
    id: mkId(),
    parentId,
    mergeIds: mergeIds || [],
    prompt,
    response,
    branch,
    ts: Date.now(),
  };
  if (model) c.model = model;
  if (extras?.attachments?.length) c.attachments = extras.attachments;
  if (extras?.citations?.length) c.citations = extras.citations;
  if (extras?.responseBlocks?.length) c.responseBlocks = extras.responseBlocks;
  if (extras?.activities?.length) c.activities = extras.activities;
  if (extras?.webSearch) c.webSearch = true;
  return c;
}

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};

export function buildMsgs(
  thread: Commit[],
  finalUserMsg: string,
  finalAttachments?: Attachment[],
): ChatMsg[] {
  const msgs: ChatMsg[] = [];
  for (const c of thread) {
    const m: ChatMsg = { role: "user", content: c.prompt };
    if (c.attachments?.length) m.attachments = c.attachments;
    msgs.push(m);
    if (c.response) msgs.push({ role: "assistant", content: c.response });
  }
  const last: ChatMsg = { role: "user", content: finalUserMsg };
  if (finalAttachments?.length) last.attachments = finalAttachments;
  msgs.push(last);
  return msgs;
}

export function getThread(commits: Commit[], hid: CommitId | null): Commit[] {
  const t: Commit[] = [];
  let id = hid;
  const v = new Set<CommitId>();
  while (id && !v.has(id)) {
    v.add(id);
    const c = commits.find((x) => x.id === id);
    if (!c) break;
    t.unshift(c);
    id = c.parentId;
  }
  return t;
}

export function bNames(c: Commit[]): string[] {
  return [...new Set(c.map((x) => x.branch))];
}
export function bHead(c: Commit[], b: string): Commit | null {
  const bc = c.filter((x) => x.branch === b);
  return bc.length ? bc[bc.length - 1] : null;
}
