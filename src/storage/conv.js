import storage from "../lib/storage";
import seedMobyDick from "../seed-moby-dick";
import { normalizeClusters } from "./clusters";

export function persistConv(cv) {
  storage.set(cv.id, JSON.stringify(cv));
}

export function persistCluster(cluster) {
  storage.set(cluster.id, JSON.stringify(cluster));
}

export function loadAllConvsAndClusters() {
  seedMobyDick();
  const r = storage.list("conv:");
  if (!r?.keys?.length) return null;
  const cs = [];
  for (const k of r.keys) { const p = storage.get(k); if (p?.value) { try { cs.push(JSON.parse(p.value)); } catch {} } }
  const cr = storage.list("cluster:");
  const loadedClusters = [];
  if (cr?.keys?.length) {
    for (const k of cr.keys) { const p = storage.get(k); if (p?.value) { try { loadedClusters.push(JSON.parse(p.value)); } catch {} } }
  }
  const normalized = normalizeClusters(cs, loadedClusters);
  const sorted = normalized.convs.sort((a, b) => (b.u || "").localeCompare(a.u || ""));
  return { convs: sorted, clusters: normalized.clusters };
}

export function deleteConvCascade(convs, id) {
  const deletedIds = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of convs) {
      if (!deletedIds.has(c.id) && c.parentRef && deletedIds.has(c.parentRef.convId)) {
        deletedIds.add(c.id); grew = true;
      }
    }
  }
  const nextConvs = convs.filter(c => !deletedIds.has(c.id));
  return { nextConvs, deletedIds };
}
