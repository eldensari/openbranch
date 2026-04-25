import { useState, useEffect, MutableRefObject } from "react";
import { persistConv } from "../storage/conv";
import { branchPathToRoot } from "../graph/branches";
import { sidebarBranchKey } from "../storage/sidebar";

export function useConversationTags(deps: {
  convs: any[];
  setConvs: (updater: any) => void;
  clusters: any[];
  expandedClusters: Set<any>;
  setExpandedClusters: (updater: any) => void;
  openSidebarItems: Set<any>;
  setOpenSidebarItems: (updater: any) => void;
  convId: any;
  commits: any[];
  setCommits: (updater: any) => void;
  cRef: MutableRefObject<any[]>;
  headId: any;
  branch: any;
  save: (title: any, cm: any, hid: any, br: any, pRef?: any, forceNewId?: boolean) => any;
}) {
  const { convs, setConvs, clusters, expandedClusters, setExpandedClusters, openSidebarItems, setOpenSidebarItems, convId, setCommits, cRef, headId, branch, save } = deps;

  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set());

  // Auto-expand folder/conv/branch chain when a tag filter is activated
  useEffect(() => {
    if (activeTags.size === 0) return;
    const clusterMap = new Map(clusters.map(c => [c.id, c]));
    const folderSet = new Set(expandedClusters);
    const itemSet = new Set(openSidebarItems);
    convs.forEach(cv => {
      const matchingCommits = (cv.commits || []).filter((c: any) => (c.tags || []).some((tg: string) => activeTags.has(tg)));
      if (!matchingCommits.length) return;
      let fid = cv.clusterId;
      const seen = new Set();
      while (fid && !seen.has(fid)) {
        seen.add(fid);
        folderSet.add(fid);
        fid = clusterMap.get(fid)?.parentId || null;
      }
      itemSet.add(cv.id + ":conv");
      const matchingBranches = new Set(matchingCommits.map((c: any) => c.branch));
      matchingBranches.forEach((bName: any) => {
        const path = branchPathToRoot(cv.commits || [], bName as string);
        path.forEach((b: string) => itemSet.add(sidebarBranchKey(cv.id, b)));
      });
    });
    setExpandedClusters(folderSet);
    setOpenSidebarItems(itemSet);
  }, [activeTags]); // eslint-disable-line react-hooks/exhaustive-deps

  const renameTag = (oldName: string, newName: string) => {
    const trimmed = (newName || "").trim().replace(/^#+/, "");
    if (!trimmed || trimmed === oldName) return;
    const touched: any[] = [];
    const nextConvs = convs.map(cv => {
      let changed = false;
      const newCommits = (cv.commits || []).map((c: any) => {
        if (!(c.tags || []).includes(oldName)) return c;
        changed = true;
        const merged = c.tags.map((tg: string) => tg === oldName ? trimmed : tg);
        const deduped = [...new Set(merged)];
        return { ...c, tags: deduped };
      });
      if (!changed) return cv;
      const updated = { ...cv, commits: newCommits, u: new Date().toISOString() };
      touched.push(updated);
      return updated;
    });
    touched.forEach(persistConv);
    setConvs(nextConvs);
    const currentCv = nextConvs.find(c => c.id === convId);
    if (currentCv) { setCommits(currentCv.commits); cRef.current = currentCv.commits; }
    setActiveTags(p => {
      if (!p.has(oldName)) return p;
      const n = new Set(p); n.delete(oldName); n.add(trimmed); return n;
    });
  };

  const deleteTag = (name: string) => {
    const touched: any[] = [];
    const nextConvs = convs.map(cv => {
      let changed = false;
      const newCommits = (cv.commits || []).map((c: any) => {
        if (!(c.tags || []).includes(name)) return c;
        changed = true;
        const filtered = c.tags.filter((tg: string) => tg !== name);
        if (filtered.length === 0) { const { tags: _drop, ...rest } = c; return rest; }
        return { ...c, tags: filtered };
      });
      if (!changed) return cv;
      const updated = { ...cv, commits: newCommits, u: new Date().toISOString() };
      touched.push(updated);
      return updated;
    });
    touched.forEach(persistConv);
    setConvs(nextConvs);
    const currentCv = nextConvs.find(c => c.id === convId);
    if (currentCv) { setCommits(currentCv.commits); cRef.current = currentCv.commits; }
    setActiveTags(p => { if (!p.has(name)) return p; const n = new Set(p); n.delete(name); return n; });
  };

  const editCommitTags = (cid: string, tagsInput: string) => {
    const tags = (tagsInput || "")
      .split(",")
      .map((s: string) => s.trim().replace(/^#+/, ""))
      .filter(Boolean);
    const newCommits = cRef.current.map((c: any) => {
      if (c.id !== cid) return c;
      const { tags: _omit, ...rest } = c;
      return tags.length ? { ...rest, tags } : rest;
    });
    setCommits(newCommits); cRef.current = newCommits;
    save(null, newCommits, headId, branch);
  };

  return { activeTags, setActiveTags, renameTag, deleteTag, editCommitTags };
}
