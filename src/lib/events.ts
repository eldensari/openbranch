import type { Commit, CommitEvent } from "@/types";

// Derive a canonical event timeline from a commit. Existing commits store the
// timeline implicitly across thinking/response/citations fields; future code
// (e.g. /code mode with interleaved tool_use events) can populate `events`
// directly. This helper exists so call sites can read a single ordered stream
// without caring which path produced the data.
export function commitToEvents(c: Commit): CommitEvent[] {
  if (c.events?.length) return c.events;

  const out: CommitEvent[] = [];

  if (c.thinking?.text) {
    out.push({
      type: "thinking",
      text: c.thinking.text,
      startedAt: c.thinking.startedAt,
      endedAt: c.thinking.finishedAt,
      durationMs: c.thinking.durationMs,
    });
  }

  if (c.response) {
    out.push({ type: "text", content: c.response });
  }

  for (const cit of c.citations || []) {
    out.push({ type: "reference", ref: cit });
  }

  return out;
}
