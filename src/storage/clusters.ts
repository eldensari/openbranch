import storage from "../lib/storage";
import type { Conversation } from "@/types";

export type Cluster = {
  id: string;
  title?: string;
  parentId?: string | null;
  auto?: boolean;
  createdAt?: string;
  u?: string;
};

export type FolderGroup = {
  folder: Cluster;
  items: Conversation[];
  children: FolderGroup[];
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatClusterTitle(value?: string | number | Date | null): string {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "Untitled";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function mkClusterId(): string {
  return "cluster:" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
}
export const mkFolderId = mkClusterId;

export function getConvCreatedAt(cv: Conversation): string {
  if ((cv as any).createdAt) return (cv as any).createdAt;
  const firstTs = (cv.commits || []).reduce<number | null>(
    (min, c) => (c.ts && (!min || c.ts < min) ? c.ts : min),
    null,
  );
  if (firstTs) return new Date(firstTs).toISOString();
  return (cv as any).u || new Date().toISOString();
}

function findRootConvForCluster(cv: Conversation, convMap: Map<string, Conversation>): Conversation {
  const seen = new Set<string>();
  let cur: Conversation | undefined = cv;
  while (cur?.parentRef?.convId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = convMap.get(cur.parentRef.convId);
    if (!parent) break;
    cur = parent;
  }
  return cur || cv;
}

export function folderAncestry(folderId: string, clusterMap: Map<string, Cluster>): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur = clusterMap.get(folderId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur.id);
    if (!cur.parentId) break;
    cur = clusterMap.get(cur.parentId);
  }
  return chain;
}

function sanitizeFolderParentId(folder: Cluster, clusterMap: Map<string, Cluster>): string | null {
  if (!folder.parentId) return null;
  if (folder.parentId === folder.id) return null;
  if (!clusterMap.has(folder.parentId)) return null;
  const seen = new Set<string>();
  let cur = clusterMap.get(folder.parentId);
  while (cur) {
    if (cur.id === folder.id) return null;
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    if (!cur.parentId) return folder.parentId;
    cur = clusterMap.get(cur.parentId);
  }
  return folder.parentId;
}

export function normalizeClusters(
  convs: Conversation[],
  clusters: Cluster[],
): { convs: Conversation[]; clusters: Cluster[] } {
  const convMap = new Map(convs.map((c) => [c.id, c]));
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const nextConvs: Conversation[] = [];

  for (const cv of convs) {
    const createdAt = getConvCreatedAt(cv);
    let clusterId =
      (cv as any).clusterId && clusterMap.has((cv as any).clusterId)
        ? (cv as any).clusterId
        : null;
    if (!clusterId) {
      const root = findRootConvForCluster(cv, convMap);
      const rootCreatedAt = getConvCreatedAt(root);
      clusterId =
        (root as any).clusterId && clusterMap.has((root as any).clusterId)
          ? (root as any).clusterId
          : "cluster:" + root.id;
      if (!clusterMap.has(clusterId)) {
        const cluster: Cluster = {
          id: clusterId,
          title: formatClusterTitle(rootCreatedAt),
          parentId: null,
          createdAt: rootCreatedAt,
          u: (root as any).u || rootCreatedAt,
        };
        clusterMap.set(clusterId, cluster);
        storage.set(cluster.id, JSON.stringify(cluster));
      }
    }
    const next: Conversation = { ...cv, clusterId, createdAt } as Conversation;
    if (
      (next as any).clusterId !== (cv as any).clusterId ||
      (next as any).createdAt !== (cv as any).createdAt
    ) {
      storage.set(next.id, JSON.stringify(next));
    }
    nextConvs.push(next);
  }

  for (const [id, folder] of clusterMap) {
    const fixedParent = sanitizeFolderParentId(folder, clusterMap);
    const inferredAuto = folder.title === formatClusterTitle(folder.createdAt);
    const nextAuto = folder.auto === undefined ? inferredAuto : folder.auto;
    const parentChanged = (folder.parentId || null) !== fixedParent;
    const autoChanged = folder.auto === undefined;
    if (parentChanged || autoChanged) {
      const next: Cluster = { ...folder, parentId: fixedParent, auto: nextAuto };
      clusterMap.set(id, next);
      storage.set(next.id, JSON.stringify(next));
    }
  }

  return {
    convs: nextConvs,
    clusters: Array.from(clusterMap.values()).sort((a, b) =>
      (b.u || b.createdAt || "").localeCompare(a.u || a.createdAt || ""),
    ),
  };
}

export function buildFolderTree(clusters: Cluster[]): {
  rootFolders: Cluster[];
  childrenByParentId: Map<string, Cluster[]>;
} {
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const childrenByParentId = new Map<string, Cluster[]>();
  const rootFolders: Cluster[] = [];
  for (const f of clusters) {
    const parentId =
      f.parentId && clusterMap.has(f.parentId) && f.parentId !== f.id ? f.parentId : null;
    if (parentId) {
      if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
      childrenByParentId.get(parentId)!.push(f);
    } else {
      rootFolders.push(f);
    }
  }
  const sortByRecency = (arr: Cluster[]) =>
    arr.sort((a, b) =>
      (b.u || b.createdAt || "").localeCompare(a.u || a.createdAt || ""),
    );
  sortByRecency(rootFolders);
  for (const arr of childrenByParentId.values()) sortByRecency(arr);
  return { rootFolders, childrenByParentId };
}

export function buildFolderGroups(
  convs: Conversation[],
  clusters: Cluster[],
): { topLevelConvs: Conversation[]; rootFolders: FolderGroup[] } {
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const isAuto = (folder: Cluster | undefined) => !!folder && folder.auto === true;
  const itemsByFolderId = new Map<string, Conversation[]>();
  const topLevelConvs: Conversation[] = [];
  for (const cv of convs) {
    const folder = (cv as any).clusterId ? clusterMap.get((cv as any).clusterId) : null;
    if (!folder || isAuto(folder)) {
      topLevelConvs.push(cv);
      continue;
    }
    if (!itemsByFolderId.has(folder.id)) itemsByFolderId.set(folder.id, []);
    itemsByFolderId.get(folder.id)!.push(cv);
  }
  for (const arr of itemsByFolderId.values()) {
    arr.sort((a, b) => getConvCreatedAt(b).localeCompare(getConvCreatedAt(a)));
  }
  topLevelConvs.sort((a, b) => getConvCreatedAt(b).localeCompare(getConvCreatedAt(a)));
  const userFolders = clusters.filter((f) => !isAuto(f));
  const { rootFolders, childrenByParentId } = buildFolderTree(userFolders);
  const decorate = (folder: Cluster): FolderGroup => ({
    folder,
    items: itemsByFolderId.get(folder.id) || [],
    children: (childrenByParentId.get(folder.id) || []).map(decorate),
  });
  return {
    topLevelConvs,
    rootFolders: rootFolders.map(decorate),
  };
}

export type ClusterGroup = { cluster: Cluster; items: Conversation[] };

export function buildClusterGroups(convs: Conversation[], clusters: Cluster[]): ClusterGroup[] {
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const groups: Record<string, ClusterGroup> = {};
  for (const cv of convs) {
    const id = (cv as any).clusterId || "cluster:unfiled";
    if (!groups[id]) {
      const createdAt = getConvCreatedAt(cv);
      groups[id] = {
        cluster:
          clusterMap.get(id) || {
            id,
            title: formatClusterTitle(createdAt),
            parentId: null,
            createdAt,
            u: (cv as any).u || createdAt,
          },
        items: [],
      };
    }
    groups[id].items.push(cv);
  }
  return Object.values(groups)
    .map((g) => ({
      ...g,
      items: g.items.sort((a, b) => getConvCreatedAt(a).localeCompare(getConvCreatedAt(b))),
    }))
    .sort((a, b) =>
      (b.cluster.u || b.cluster.createdAt || "").localeCompare(
        a.cluster.u || a.cluster.createdAt || "",
      ),
    );
}
