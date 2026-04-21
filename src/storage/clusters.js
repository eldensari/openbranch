import storage from "../lib/storage";

function pad2(n) { return String(n).padStart(2, "0"); }

export function formatClusterTitle(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "Untitled";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function mkClusterId() { return "cluster:" + Date.now() + "_" + Math.random().toString(36).slice(2, 5); }

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

export function normalizeClusters(convs, clusters) {
  const convMap = new Map(convs.map(c => [c.id, c]));
  const clusterMap = new Map(clusters.map(c => [c.id, c]));
  const nextConvs = [];

  for (const cv of convs) {
    const root = findRootConvForCluster(cv, convMap);
    const createdAt = getConvCreatedAt(cv);
    const rootCreatedAt = getConvCreatedAt(root);
    const clusterId = root.clusterId || cv.clusterId || ("cluster:" + root.id);
    let cluster = clusterMap.get(clusterId);
    if (!cluster) {
      cluster = { id: clusterId, title: formatClusterTitle(rootCreatedAt), createdAt: rootCreatedAt, u: root.u || rootCreatedAt };
      clusterMap.set(clusterId, cluster);
      storage.set(cluster.id, JSON.stringify(cluster));
    }
    const next = { ...cv, clusterId, createdAt };
    if (next.clusterId !== cv.clusterId || next.createdAt !== cv.createdAt) storage.set(next.id, JSON.stringify(next));
    nextConvs.push(next);
  }

  return {
    convs: nextConvs,
    clusters: Array.from(clusterMap.values()).sort((a, b) => (b.u || b.createdAt || "").localeCompare(a.u || a.createdAt || "")),
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
        cluster: clusterMap.get(id) || { id, title: formatClusterTitle(createdAt), createdAt, u: cv.u || createdAt },
        items: [],
      };
    }
    groups[id].items.push(cv);
  }
  return Object.values(groups)
    .map(g => ({ ...g, items: g.items.sort((a, b) => getConvCreatedAt(a).localeCompare(getConvCreatedAt(b))) }))
    .sort((a, b) => (b.cluster.u || b.cluster.createdAt || "").localeCompare(a.cluster.u || a.cluster.createdAt || ""));
}
