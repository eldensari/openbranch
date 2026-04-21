import storage from "../lib/storage";

function pad2(n) { return String(n).padStart(2, "0"); }

export function formatClusterTitle(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "Untitled";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function mkClusterId() { return "cluster:" + Date.now() + "_" + Math.random().toString(36).slice(2, 5); }
export const mkFolderId = mkClusterId;

export function getConvCreatedAt(cv) {
  if (cv.createdAt) return cv.createdAt;
  const firstTs = (cv.commits || []).reduce((min, c) => c.ts && (!min || c.ts < min) ? c.ts : min, null);
  if (firstTs) return new Date(firstTs).toISOString();
  return cv.u || new Date().toISOString();
}

function findRootConvForCluster(cv, convMap) {
  const seen = new Set();
  let cur = cv;
  while (cur?.parentRef?.convId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = convMap.get(cur.parentRef.convId);
    if (!parent) break;
    cur = parent;
  }
  return cur || cv;
}

export function folderAncestry(folderId, clusterMap) {
  const chain = [];
  const seen = new Set();
  let cur = clusterMap.get(folderId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur.id);
    if (!cur.parentId) break;
    cur = clusterMap.get(cur.parentId);
  }
  return chain;
}

function sanitizeFolderParentId(folder, clusterMap) {
  if (!folder.parentId) return null;
  if (folder.parentId === folder.id) return null;
  if (!clusterMap.has(folder.parentId)) return null;
  const seen = new Set();
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

export function normalizeClusters(convs, clusters) {
  const convMap = new Map(convs.map(c => [c.id, c]));
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  const nextConvs = [];

  for (const cv of convs) {
    const createdAt = getConvCreatedAt(cv);
    let clusterId = cv.clusterId && clusterMap.has(cv.clusterId) ? cv.clusterId : null;
    if (!clusterId) {
      const root = findRootConvForCluster(cv, convMap);
      const rootCreatedAt = getConvCreatedAt(root);
      clusterId = (root.clusterId && clusterMap.has(root.clusterId)) ? root.clusterId : ("cluster:" + root.id);
      if (!clusterMap.has(clusterId)) {
        const cluster = { id: clusterId, title: formatClusterTitle(rootCreatedAt), parentId: null, createdAt: rootCreatedAt, u: root.u || rootCreatedAt };
        clusterMap.set(clusterId, cluster);
        storage.set(cluster.id, JSON.stringify(cluster));
      }
    }
    const next = { ...cv, clusterId, createdAt };
    if (next.clusterId !== cv.clusterId || next.createdAt !== cv.createdAt) storage.set(next.id, JSON.stringify(next));
    nextConvs.push(next);
  }

  for (const [id, folder] of clusterMap) {
    const fixedParent = sanitizeFolderParentId(folder, clusterMap);
    const inferredAuto = folder.title === formatClusterTitle(folder.createdAt);
    const nextAuto = folder.auto === undefined ? inferredAuto : folder.auto;
    const parentChanged = (folder.parentId || null) !== fixedParent;
    const autoChanged = folder.auto === undefined;
    if (parentChanged || autoChanged) {
      const next = { ...folder, parentId: fixedParent, auto: nextAuto };
      clusterMap.set(id, next);
      storage.set(next.id, JSON.stringify(next));
    }
  }

  return {
    convs: nextConvs,
    clusters: Array.from(clusterMap.values()).sort((a, b) => (b.u || b.createdAt || "").localeCompare(a.u || a.createdAt || "")),
  };
}

export function buildFolderTree(clusters) {
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  const childrenByParentId = new Map();
  const rootFolders = [];
  for (const f of clusters) {
    const parentId = f.parentId && clusterMap.has(f.parentId) && f.parentId !== f.id ? f.parentId : null;
    if (parentId) {
      if (!childrenByParentId.has(parentId)) childrenByParentId.set(parentId, []);
      childrenByParentId.get(parentId).push(f);
    } else {
      rootFolders.push(f);
    }
  }
  const sortByRecency = arr => arr.sort((a, b) => (b.u || b.createdAt || "").localeCompare(a.u || a.createdAt || ""));
  sortByRecency(rootFolders);
  for (const arr of childrenByParentId.values()) sortByRecency(arr);
  return { rootFolders, childrenByParentId };
}

export function buildFolderGroups(convs, clusters) {
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  const isAuto = folder => !!folder && folder.auto === true;
  const itemsByFolderId = new Map();
  const topLevelConvs = [];
  for (const cv of convs) {
    const folder = cv.clusterId ? clusterMap.get(cv.clusterId) : null;
    if (!folder || isAuto(folder)) {
      topLevelConvs.push(cv);
      continue;
    }
    if (!itemsByFolderId.has(folder.id)) itemsByFolderId.set(folder.id, []);
    itemsByFolderId.get(folder.id).push(cv);
  }
  for (const arr of itemsByFolderId.values()) {
    arr.sort((a, b) => getConvCreatedAt(b).localeCompare(getConvCreatedAt(a)));
  }
  topLevelConvs.sort((a, b) => getConvCreatedAt(b).localeCompare(getConvCreatedAt(a)));
  const userFolders = clusters.filter(f => !isAuto(f));
  const { rootFolders, childrenByParentId } = buildFolderTree(userFolders);
  const decorate = folder => ({
    folder,
    items: itemsByFolderId.get(folder.id) || [],
    children: (childrenByParentId.get(folder.id) || []).map(decorate),
  });
  return {
    topLevelConvs,
    rootFolders: rootFolders.map(decorate),
  };
}

export function buildClusterGroups(convs, clusters) {
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  const groups = {};
  for (const cv of convs) {
    const id = cv.clusterId || "cluster:unfiled";
    if (!groups[id]) {
      const createdAt = getConvCreatedAt(cv);
      groups[id] = {
        cluster: clusterMap.get(id) || { id, title: formatClusterTitle(createdAt), parentId: null, createdAt, u: cv.u || createdAt },
        items: [],
      };
    }
    groups[id].items.push(cv);
  }
  return Object.values(groups)
    .map(g => ({ ...g, items: g.items.sort((a, b) => getConvCreatedAt(a).localeCompare(getConvCreatedAt(b))) }))
    .sort((a, b) => (b.cluster.u || b.cluster.createdAt || "").localeCompare(a.cluster.u || a.cluster.createdAt || ""));
}
