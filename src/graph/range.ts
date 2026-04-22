// @ts-nocheck
import { mkCommit, bNames } from "./model";

export function rangeCommitsFor(source, range) {
  const start = source.find(c => c.id === range.startId);
  if (!start) return [];
  const end = source.find(c => c.id === range.endId) || start;
  if (start.branch !== end.branch) return [start];
  const list = source.filter(c => c.branch === start.branch).sort((a, b) => a.ts - b.ts);
  const ai = list.findIndex(c => c.id === start.id);
  const bi = list.findIndex(c => c.id === end.id);
  if (ai < 0 || bi < 0) return [start];
  const lo = Math.min(ai, bi), hi = Math.max(ai, bi);
  return list.slice(lo, hi + 1);
}

export function cutRangeFromCommits(source, range) {
  if (!range.length) return source;
  const ids = new Set(range.map(c => c.id));
  const glueParentId = range[0].parentId || null;
  return source
    .filter(c => !ids.has(c.id))
    .map(c => ids.has(c.parentId) ? { ...c, parentId: glueParentId } : c);
}

export function chooseHeadAfterCut(list, oldHeadId, fallbackBranch) {
  if (list.find(c => c.id === oldHeadId)) {
    const oldHead = list.find(c => c.id === oldHeadId);
    return { headId: oldHeadId, branch: oldHead?.branch || fallbackBranch || "main" };
  }
  const fallback = list.filter(c => c.branch === fallbackBranch).slice(-1)[0] || list[list.length - 1];
  return { headId: fallback?.id || null, branch: fallback?.branch || "main" };
}

export function cloneRangeCommits(range, branchName, firstParentId = null) {
  let parentId = firstParentId;
  return range.map(c => {
    const cm = mkCommit(parentId, c.prompt, c.response, branchName);
    if (c.displayLabel) cm.displayLabel = c.displayLabel;
    parentId = cm.id;
    return cm;
  });
}

export function nextBranchName(commits) {
  const existing = new Set(bNames(commits));
  let i = existing.size;
  while (existing.has("branch-" + i)) i += 1;
  return "branch-" + i;
}
