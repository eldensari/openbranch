import { mkCommit, bNames } from "./model";
import type { Commit, CommitId } from "@/types";

type Range = { startId: CommitId | null; endId: CommitId | null };

export function rangeCommitsFor(source: Commit[], range: Range): Commit[] {
  const start = source.find((c) => c.id === range.startId);
  if (!start) return [];
  const end = source.find((c) => c.id === range.endId) || start;
  if (start.branch !== end.branch) return [start];
  const list = source.filter((c) => c.branch === start.branch).sort((a, b) => a.ts - b.ts);
  const ai = list.findIndex((c) => c.id === start.id);
  const bi = list.findIndex((c) => c.id === end.id);
  if (ai < 0 || bi < 0) return [start];
  const lo = Math.min(ai, bi);
  const hi = Math.max(ai, bi);
  return list.slice(lo, hi + 1);
}

export function cutRangeFromCommits(source: Commit[], range: Commit[]): Commit[] {
  if (!range.length) return source;
  const ids = new Set(range.map((c) => c.id));
  const glueParentId = range[0].parentId || null;
  return source
    .filter((c) => !ids.has(c.id))
    .map((c) => (c.parentId && ids.has(c.parentId) ? { ...c, parentId: glueParentId } : c));
}

export function chooseHeadAfterCut(
  list: Commit[],
  oldHeadId: CommitId | null,
  fallbackBranch: string | null,
): { headId: CommitId | null; branch: string } {
  const foundHead = list.find((c) => c.id === oldHeadId);
  if (foundHead) {
    return { headId: oldHeadId, branch: foundHead.branch || fallbackBranch || "main" };
  }
  const fallback =
    list.filter((c) => c.branch === fallbackBranch).slice(-1)[0] || list[list.length - 1];
  return { headId: fallback?.id || null, branch: fallback?.branch || "main" };
}

export function cloneRangeCommits(
  range: Commit[],
  branchName: string,
  firstParentId: CommitId | null = null,
): Commit[] {
  let parentId: CommitId | null = firstParentId;
  return range.map((c) => {
    const cm = mkCommit(parentId, c.prompt, c.response, branchName);
    if ((c as Commit & { displayLabel?: string }).displayLabel) {
      (cm as Commit & { displayLabel?: string }).displayLabel = (c as Commit & {
        displayLabel?: string;
      }).displayLabel;
    }
    parentId = cm.id;
    return cm;
  });
}

export function nextBranchName(commits: Commit[]): string {
  const existing = new Set(bNames(commits));
  let i = existing.size;
  while (existing.has("branch-" + i)) i += 1;
  return "branch-" + i;
}
