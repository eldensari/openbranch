import { commitBranch } from "../graph/branches";
import { getConvCreatedAt } from "./clusters";

// Sidebar rule: new conversations are sibling notebooks; branches are child notebooks.
export function orderSectionItems(members) {
  if (!members.length) return [];
  const cmpCreated = (a, b) => getConvCreatedAt(a).localeCompare(getConvCreatedAt(b));
  return [...members].sort(cmpCreated).map(cv => ({ conv: cv, depth: 0 }));
}

export function sidebarBranchKey(convId, branchName) {
  return convId + ":branch:" + branchName;
}

export function buildSidebarLayout(members) {
  const cmpCreated = (a, b) => getConvCreatedAt(a).localeCompare(getConvCreatedAt(b));
  const sorted = [...members].sort(cmpCreated);
  const convMap = new Map(sorted.map(cv => [cv.id, cv]));
  const memo = new Map();
  const rootLoc = { type: "root" };

  const placementFor = (cv, stack = new Set()) => {
    if (memo.has(cv.id)) return memo.get(cv.id);
    if (stack.has(cv.id)) return rootLoc;
    stack.add(cv.id);

    const parent = cv.parentRef?.convId ? convMap.get(cv.parentRef.convId) : null;
    if (!parent) {
      memo.set(cv.id, rootLoc);
      stack.delete(cv.id);
      return rootLoc;
    }

    const parentLoc = placementFor(parent, stack);
    const anchorBranch = commitBranch(parent, cv.parentRef.commitId);
    const loc = anchorBranch && anchorBranch !== "main"
      ? { type: "branch", convId: parent.id, branch: anchorBranch }
      : parentLoc;
    memo.set(cv.id, loc);
    stack.delete(cv.id);
    return loc;
  };

  const rootItems = [];
  const branchChildren = new Map();
  for (const cv of sorted) {
    const loc = placementFor(cv);
    if (loc.type === "branch") {
      const key = sidebarBranchKey(loc.convId, loc.branch);
      if (!branchChildren.has(key)) branchChildren.set(key, []);
      branchChildren.get(key).push(cv);
    } else {
      rootItems.push({ conv: cv, depth: 0 });
    }
  }

  return { rootItems, branchChildren };
}
