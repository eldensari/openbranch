import { getConvCreatedAt } from "./clusters";
import type { Conversation } from "@/types";

export type SidebarItem = { conv: Conversation; depth: number };

export function orderSectionItems(members: Conversation[]): SidebarItem[] {
  if (!members.length) return [];
  const cmpCreated = (a: Conversation, b: Conversation) =>
    getConvCreatedAt(a).localeCompare(getConvCreatedAt(b));
  return [...members].sort(cmpCreated).map((cv) => ({ conv: cv, depth: 0 }));
}

export function sidebarBranchKey(convId: string, branchName: string): string {
  return convId + ":branch:" + branchName;
}

export function buildSidebarLayout(members: Conversation[]): {
  rootItems: SidebarItem[];
  childRefs: Map<string, Conversation[]>;
  branchChildren: Map<string, unknown>;
} {
  const cmpCreated = (a: Conversation, b: Conversation) =>
    getConvCreatedAt(b).localeCompare(getConvCreatedAt(a));
  const sorted = [...members].sort(cmpCreated);
  const idSet = new Set(sorted.map((cv) => cv.id));

  const rootItems: SidebarItem[] = [];
  const childRefs = new Map<string, Conversation[]>();
  for (const cv of sorted) {
    const parentId = cv.parentRef?.convId;
    if (parentId && idSet.has(parentId) && parentId !== cv.id) {
      if (!childRefs.has(parentId)) childRefs.set(parentId, []);
      childRefs.get(parentId)!.push(cv);
    } else {
      rootItems.push({ conv: cv, depth: 0 });
    }
  }

  return { rootItems, childRefs, branchChildren: new Map() };
}
