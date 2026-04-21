import { getConvCreatedAt } from "./clusters";

// Sidebar rule: conversations are independent siblings. parentRef only drives ghost references.
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
  const idSet = new Set(sorted.map(cv => cv.id));

  const rootItems = sorted.map(cv => ({ conv: cv, depth: 0 }));
  const childRefs = new Map();
  for (const cv of sorted) {
    const parentId = cv.parentRef?.convId;
    if (parentId && idSet.has(parentId) && parentId !== cv.id) {
      if (!childRefs.has(parentId)) childRefs.set(parentId, []);
      childRefs.get(parentId).push(cv);
    }
  }

  return { rootItems, childRefs, branchChildren: new Map() };
}
