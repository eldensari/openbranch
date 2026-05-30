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
} {
  const cmpCreated = (a: Conversation, b: Conversation) =>
    getConvCreatedAt(b).localeCompare(getConvCreatedAt(a));
  const sorted = [...members].sort(cmpCreated);
  const rootItems: SidebarItem[] = sorted.map((cv) => ({ conv: cv, depth: 0 }));
  return { rootItems };
}
