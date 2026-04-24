import { useState, useRef, useEffect } from "react";
import storage from "./lib/storage";
import { callLLM, detectProvider, MODEL_CHOICES } from "./lib/llm";
import { mkCommit, buildMsgs, getThread, bNames, bHead, bumpIdCounter } from "./graph/model";
import { branchPathToRoot, getBranchDescendantNames } from "./graph/branches";
import { rangeCommitsFor, cutRangeFromCommits, chooseHeadAfterCut, cloneRangeCommits, nextBranchName } from "./graph/range";
import { formatClusterTitle, mkClusterId, mkFolderId, buildClusterGroups, folderAncestry } from "./storage/clusters";
import { sidebarBranchKey } from "./storage/sidebar";
import { loadAllConvsAndClusters, persistConv, persistCluster, deleteConvCascade } from "./storage/conv";
import AppSidebar from "./ui/Sidebar";
import ChatPanel from "./ui/ChatPanel";
import { SidebarProvider } from "./components/ui/sidebar";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./components/ui/resizable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";

/* ═══════ MAIN ═══════ */
export default function App() {
  const [apiKey, setApiKey] = useState(() => storage.get("apiKey")?.value || "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const hasKey = !!apiKey.trim();
  const [model, setModel] = useState(() => storage.get("model")?.value || "");
  const [thinkingOn, setThinkingOn] = useState(() => storage.get("thinkingOn")?.value === "1");
  const providerId = hasKey ? detectProvider(apiKey)?.id : "free";
  const modelList = MODEL_CHOICES[providerId] || MODEL_CHOICES.free;
  const currentModel = modelList.some(m => m.id === model) ? model : modelList[0].id;
  const currentModelMeta = modelList.find(m => m.id === currentModel) || modelList[0];
  const [rateLimited, setRateLimited] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState(null); // null | "sending" | "done" | "error"

  const [commits, setCommits] = useState([]);
  const [headId, setHeadId] = useState(null);
  const [branch, setBranch] = useState("main");
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pending, setPending] = useState(null);
  const [graph, setGraph] = useState(true);
  const [mm, setMm] = useState(false);
  const [sel, setSel] = useState([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectRange, setSelectRange] = useState({ startId: null, endId: null });
  const [selectError, setSelectError] = useState("");
  const [undoAction, setUndoAction] = useState(null);
  const [editId, setEditId] = useState(null);
  const [branchFromId, setBranchFromId] = useState(null);
  const [newFromRef, setNewFromRef] = useState(null);
  const [convs, setConvs] = useState([]);
  const [clusters, setClusters] = useState([]);
  const [convId, setConvId] = useState(null);
  const [parentRef, setParentRef] = useState(null);
  const [graphW, setGraphW] = useState(280);
  const [scrollTarget, setScrollTarget] = useState(null);
  const [hoveredCid, setHoveredCid] = useState(null);
  const [activeTags, setActiveTags] = useState(() => new Set());
  const [chatMenu, setChatMenu] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null); // { msg, onConfirm } | null
  const [renamingId, setRenamingId] = useState(null);
  const [renamingBranch, setRenamingBranch] = useState(null); // { convId, branch } | null
  const [renamingClusterId, setRenamingClusterId] = useState(null);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [expandedClusters, setExpandedClusters] = useState(() => new Set());
  const [openSidebarItems, setOpenSidebarItems] = useState(() => new Set());
  const [closedSidebarItems, setClosedSidebarItems] = useState(() => new Set());
  const [renameVal, setRenameVal] = useState("");
  const dragging = useRef(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const cRef = useRef(commits); cRef.current = commits;
  const sendRef = useRef(null);

  // Seed data on first visit, then load convs
  useEffect(() => {
    const loaded = loadAllConvsAndClusters();
    if (loaded) {
      setClusters(loaded.clusters);
      setConvs(loaded.convs);
      // Auto-open Moby Dick on first visit (no conv selected yet)
      const moby = loaded.convs.find(c => c.id === "conv:moby_dick");
      if (moby && !convId) {
        load(moby);
        setGraph(true);
      }
    }
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [commits, headId, pending]);

  // Auto-expand folder/conv/branch chain when a tag filter is activated
  useEffect(() => {
    if (activeTags.size === 0) return;
    const clusterMap = new Map(clusters.map(c => [c.id, c]));
    const folderSet = new Set(expandedClusters);
    const itemSet = new Set(openSidebarItems);
    convs.forEach(cv => {
      const matchingCommits = (cv.commits || []).filter(c => (c.tags || []).some(tg => activeTags.has(tg)));
      if (!matchingCommits.length) return;
      let fid = cv.clusterId;
      const seen = new Set();
      while (fid && !seen.has(fid)) {
        seen.add(fid);
        folderSet.add(fid);
        fid = clusterMap.get(fid)?.parentId || null;
      }
      itemSet.add(cv.id + ":conv");
      const matchingBranches = new Set(matchingCommits.map(c => c.branch));
      matchingBranches.forEach((bName: string) => {
        const path = branchPathToRoot(cv.commits || [], bName);
        path.forEach((b: string) => itemSet.add(sidebarBranchKey(cv.id, b)));
      });
    });
    setExpandedClusters(folderSet);
    setOpenSidebarItems(itemSet);
  }, [activeTags]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-send from starter cards (use setTimeout to ensure state is settled)
  useEffect(() => {
    if (sendRef.current && input === sendRef.current) {
      const q = sendRef.current;
      sendRef.current = null;
      // Defer to next tick so send() captures the updated input
      setTimeout(() => send(), 0);
    }
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollTarget) {
      const el = document.getElementById("cm-" + scrollTarget);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      setScrollTarget(null);
    }
  }, [scrollTarget, headId]);

  const touchCluster = (clusterId, createdAt) => {
    const now = new Date().toISOString();
    let cluster = clusters.find(c => c.id === clusterId);
    if (!cluster) {
      cluster = { id: clusterId, title: formatClusterTitle(createdAt || now), parentId: null, auto: true, createdAt: createdAt || now, u: createdAt || now };
    }
    persistCluster(cluster);
    setClusters(p => [...p.filter(c => c.id !== cluster.id), cluster]);
    return cluster;
  };

  // `convs` state can be a stale closure snapshot inside async flows
  // (e.g., the second save() in the newFromRef branch runs after await callLLM
  // and doesn't see the first save()'s addition). Fall back to storage so
  // cluster/title/branchTitles from the prior save are preserved.
  const resolveExistingConv = (id) => {
    let existing = convs.find(c => c.id === id);
    if (!existing) {
      const stored = storage.get(id);
      if (stored?.value) { try { existing = JSON.parse(stored.value); } catch {} }
    }
    return existing;
  };
  const buildConvRecord = (id, existing, title, cm, hid, br, pRef) => {
    const parentConv = pRef?.convId ? convs.find(c => c.id === pRef.convId) : null;
    const currentConv = convs.find(c => c.id === convId);
    const createdAt = existing?.createdAt || new Date().toISOString();
    const clusterId = existing?.clusterId || parentConv?.clusterId || currentConv?.clusterId || activeFolderId || mkClusterId();
    touchCluster(clusterId, createdAt);
    const finalTitle = existing?.title || title || (cm.length > 0 ? cm[0].prompt?.slice(0, 40) : "Untitled");
    return { id, title: finalTitle, commits: cm, headId: hid, branch: br, parentRef: pRef || parentRef || null, branchTitles: existing?.branchTitles || {}, labels: existing?.labels || [], clusterId, createdAt, u: new Date().toISOString() };
  };
  const save = (title, cm, hid, br, pRef = null, forceNewId = null) => {
    const id = forceNewId || convId || "conv:" + Date.now();
    const existing = resolveExistingConv(id);
    const cv = buildConvRecord(id, existing, title, cm, hid, br, pRef);
    persistConv(cv);
    setConvs(p => [cv, ...p.filter(c => c.id !== id)]);
    setConvId(id);
  };

  const load = cv => {
    const commits = cv.commits || [];
    setCommits(commits); setHeadId(cv.headId); setBranch(cv.branch || "main");
    setConvId(cv.id); setParentRef(cv.parentRef || null);
    bumpIdCounter(commits.length + 10);
    setMm(false); setSel([]); setSelectMode(false); clearSelectRange(); setEditId(null); setBranchFromId(null); setPending(null); setNewFromRef(null); setRenamingClusterId(null);
  };
  const loadMain = cv => {
    load(cv);
    const mainLeaf = bHead(cv.commits || [], "main");
    if (mainLeaf) { setHeadId(mainLeaf.id); setBranch("main"); setScrollTarget(mainLeaf.id); }
  };
  // Cascade delete: remove conv + all descendant convs (parentRef chain).
  const del = id => {
    rememberUndo("Deleted conversation");
    const { deletedIds } = deleteConvCascade(convs, id);
    for (const x of deletedIds) storage.del(x);
    setConvs(p => p.filter(c => !deletedIds.has(c.id)));
    if (deletedIds.has(convId)) {
      setCommits([]); setHeadId(null); setConvId(null); setParentRef(null); setBranch("main");
    }
  };
  const countChildConvs = (id) => {
    const set = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of convs) {
        if (!set.has(c.id) && c.parentRef && set.has(c.parentRef.convId)) {
          set.add(c.id); grew = true;
        }
      }
    }
    return set.size - 1;
  };
  // Rename only affects the sidebar label via branchTitles map.
  // commit.branch (technical identifier) is untouched.
  // Empty title clears the override (restores prompt-summary default).
  const renameBranch = (cvId, bName, newTitle) => {
    const cv = convs.find(c => c.id === cvId);
    if (!cv) return;
    const trimmed = (newTitle || "").trim();
    const titles = { ...(cv.branchTitles || {}) };
    if (!trimmed) delete titles[bName];
    else titles[bName] = trimmed;
    const updated = { ...cv, branchTitles: titles, u: new Date().toISOString() };
    storage.set(cvId, JSON.stringify(updated));
    setConvs(p => p.map(c => c.id === cvId ? updated : c));
  };
  const computeBranchRemoval = (cv, bName) => {
    const oldCommits = cv.commits || [];
    const toRemoveSet = new Set([bName, ...getBranchDescendantNames(oldCommits, bName)]);
    const newCommits = oldCommits.filter(c => !toRemoveSet.has(c.branch));
    let newBranch = cv.branch;
    let newHeadId = cv.headId;
    if (toRemoveSet.has(cv.branch)) {
      newBranch = newCommits.find(c => c.branch === "main") ? "main" : (bNames(newCommits)[0] || "main");
    }
    if (!newCommits.find(c => c.id === newHeadId)) {
      const leaf = bHead(newCommits, newBranch);
      newHeadId = leaf?.id || null;
    }
    const titles = { ...(cv.branchTitles || {}) };
    for (const removed of toRemoveSet) delete titles[removed];
    return { newCommits, newBranch, newHeadId, titles };
  };
  const deleteBranchCascade = (cvId, bName) => {
    const cv = convs.find(c => c.id === cvId);
    if (!cv) return;
    rememberUndo("Deleted branch");
    const { newCommits, newBranch, newHeadId, titles } = computeBranchRemoval(cv, bName);
    const updated = { ...cv, commits: newCommits, branch: newBranch, headId: newHeadId, branchTitles: titles, u: new Date().toISOString() };
    storage.set(cvId, JSON.stringify(updated));
    setConvs(p => p.map(c => c.id === cvId ? updated : c));
    if (cvId === convId) {
      setCommits(newCommits); cRef.current = newCommits;
      setBranch(newBranch); setHeadId(newHeadId);
    }
  };
  const renameConv = (id, newTitle) => {
    const cv = convs.find(c => c.id === id);
    if (!cv || !newTitle.trim()) return;
    const updated = { ...cv, title: newTitle.trim(), u: new Date().toISOString() };
    storage.set(id, JSON.stringify(updated));
    setConvs(p => p.map(c => c.id === id ? updated : c));
  };
  const renameCluster = (id, newTitle) => {
    const cluster = clusters.find(c => c.id === id);
    if (!cluster) return;
    const trimmed = (newTitle || "").trim();
    const updated = { ...cluster, title: trimmed || formatClusterTitle(cluster.createdAt), auto: false };
    storage.set(id, JSON.stringify(updated));
    setClusters(p => p.map(c => c.id === id ? updated : c));
  };
  const toggleCluster = (id) => {
    setExpandedClusters(p => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const expandFolder = (id) => {
    if (!id) return;
    setExpandedClusters(p => { const n = new Set(p); n.add(id); return n; });
  };
  const toggleSidebarItem = (id, defaultOpen = false) => {
    const setter = defaultOpen ? setClosedSidebarItems : setOpenSidebarItems;
    setter(p => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const sidebarItemOpen = (id, defaultOpen = false) => defaultOpen ? !closedSidebarItems.has(id) : openSidebarItems.has(id);
  const newConv = () => { setCommits([]); setHeadId(null); setBranch("main"); setConvId(null); setParentRef(null); setMm(false); setSel([]); setSelectMode(false); clearSelectRange(); setEditId(null); setBranchFromId(null); setPending(null); setNewFromRef(null); setRenamingClusterId(null); };

  const renameFolder = renameCluster;
  const createFolder = (parentId = null) => {
    const now = new Date().toISOString();
    const folder = { id: mkFolderId(), title: "Untitled", parentId: parentId || null, auto: false, createdAt: now, u: now };
    persistCluster(folder);
    setClusters(p => [folder, ...p]);
    return folder;
  };
  const moveConvToFolder = (cvId, folderId) => {
    const cv = convs.find(c => c.id === cvId);
    if (!cv) return;
    const targetId = folderId || null;
    if (cv.clusterId === targetId) return;
    const updated = { ...cv, clusterId: targetId, u: new Date().toISOString() };
    persistConv(updated);
    setConvs(p => p.map(c => c.id === cvId ? updated : c));
  };
  const moveFolder = (folderId, newParentId) => {
    const folder = clusters.find(c => c.id === folderId);
    if (!folder) return;
    const parent = newParentId || null;
    if (parent === folderId) return;
    if (parent) {
      const clusterMap = new Map(clusters.map(c => [c.id, c]));
      if (folderAncestry(parent, clusterMap).includes(folderId)) return;
    }
    if ((folder.parentId || null) === parent) return;
    const updated = { ...folder, parentId: parent, u: new Date().toISOString() };
    persistCluster(updated);
    setClusters(p => p.map(c => c.id === folderId ? updated : c));
  };
  const collectFolderDescendants = (folderId) => {
    const set = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of clusters) {
        if (!set.has(c.id) && c.parentId && set.has(c.parentId)) { set.add(c.id); grew = true; }
      }
    }
    return set;
  };
  const deleteFolder = (folderId, { mode = "reassignToParent" } = {}) => {
    const folder = clusters.find(c => c.id === folderId);
    if (!folder) return;
    rememberUndo(mode === "cascade" ? "Deleted folder and contents" : "Deleted folder");
    if (mode === "cascade") {
      const affectedFolders = collectFolderDescendants(folderId);
      const deletedConvIds = new Set();
      for (const cv of convs) {
        if (affectedFolders.has(cv.clusterId)) {
          const { deletedIds } = deleteConvCascade(convs, cv.id);
          deletedIds.forEach(id => deletedConvIds.add(id));
        }
      }
      for (const id of deletedConvIds as Set<string>) storage.del(id);
      setConvs(p => p.filter(c => !deletedConvIds.has(c.id)));
      for (const id of affectedFolders as Set<string>) storage.del(id);
      setClusters(p => p.filter(c => !affectedFolders.has(c.id)));
      if (deletedConvIds.has(convId)) {
        setCommits([]); setHeadId(null); setConvId(null); setParentRef(null); setBranch("main");
      }
      if (activeFolderId && affectedFolders.has(activeFolderId)) setActiveFolderId(null);
    } else {
      const targetParent = folder.parentId || null;
      const movedConvs = [];
      for (const cv of convs) {
        if (cv.clusterId === folderId) {
          const updated = { ...cv, clusterId: targetParent, u: new Date().toISOString() };
          persistConv(updated);
          movedConvs.push(updated);
        }
      }
      setConvs(p => p.map(c => movedConvs.find(m => m.id === c.id) || c));
      const promotedFolders = [];
      for (const f of clusters) {
        if (f.parentId === folderId) {
          const updated = { ...f, parentId: targetParent, u: new Date().toISOString() };
          persistCluster(updated);
          promotedFolders.push(updated);
        }
      }
      storage.del(folderId);
      setClusters(p => p
        .filter(c => c.id !== folderId)
        .map(c => promotedFolders.find(f => f.id === c.id) || c));
      if (activeFolderId === folderId) setActiveFolderId(targetParent);
    }
  };

  const thread = getThread(commits, headId);
  const names = bNames(commits);

  const childRefs = convId ? convs.filter(cv => cv.parentRef?.convId === convId && cv.id !== convId).map(cv => ({
    convId: cv.id, commitId: cv.parentRef.commitId, convTitle: cv.title || "Untitled",
  })) : [];

  const clusterGroups = buildClusterGroups(convs, clusters);
  const selectedRangeCommits = rangeCommitsFor(commits, selectRange);
  const selectedRangeIds = selectedRangeCommits.map(c => c.id);
  const clearSelectRange = () => { setSelectRange({ startId: null, endId: null }); setSelectError(""); };
  const snap = value => JSON.parse(JSON.stringify(value));
  const rememberUndo = label => {
    setUndoAction({
      label,
      convs: snap(convs),
      clusters: snap(clusters),
      current: { convId, commits: snap(commits), headId, branch, parentRef: snap(parentRef) },
    });
  };
  const restoreUndo = () => {
    if (!undoAction) return;
    const beforeConvIds = new Set(undoAction.convs.map(c => c.id));
    convs.forEach(c => { if (!beforeConvIds.has(c.id)) storage.del(c.id); });
    undoAction.convs.forEach(c => storage.set(c.id, JSON.stringify(c)));

    const beforeClusterIds = new Set(undoAction.clusters.map(c => c.id));
    clusters.forEach(c => { if (!beforeClusterIds.has(c.id)) storage.del(c.id); });
    undoAction.clusters.forEach(c => storage.set(c.id, JSON.stringify(c)));

    setConvs(undoAction.convs);
    setClusters(undoAction.clusters);
    setConvId(undoAction.current.convId);
    setCommits(undoAction.current.commits);
    cRef.current = undoAction.current.commits;
    setHeadId(undoAction.current.headId);
    setBranch(undoAction.current.branch);
    setParentRef(undoAction.current.parentRef);
    setUndoAction(null);
    setSelectMode(false);
    clearSelectRange();
  };
  // Auto-show graph when conversation has commits
  const showGraph = graph || commits.length > 0;

  // ─── SEND ───
  const applyCommitResult = (nc, cmId) => {
    setCommits(nc); cRef.current = nc; setHeadId(cmId); setPending(null);
  };
  const sendNewFromRef = async (msg) => {
    const pRef = { convId: newFromRef.convId, commitId: newFromRef.commitId, wasHead: newFromRef.wasHead !== false, convTitle: newFromRef.convTitle, promptSummary: newFromRef.promptSummary, anchorBranch: newFromRef.anchorBranch };
    const newId = "conv:" + Date.now();
    if (newFromRef.anchorBranch && newFromRef.anchorBranch !== "main") {
      setOpenSidebarItems(p => {
        const n = new Set(p);
        (newFromRef.branchPath || [newFromRef.anchorBranch]).forEach(b => n.add(sidebarBranchKey(newFromRef.convId, b)));
        return n;
      });
    }
    const thread = newFromRef.thread || [];

    setCommits([]); cRef.current = [];
    setHeadId(null); setBranch("main"); setConvId(newId);
    setParentRef(pRef); setNewFromRef(null); setGraph(true);
    save(msg.slice(0, 40), [], null, "main", pRef, newId);

    setPending(msg); setThinking(true);
    try {
      const msgs = buildMsgs(thread, msg);
      const resp = await callLLM(apiKey, msgs, currentModel, thinkingOn);
      const cm = mkCommit(null, msg, resp, "main", null, currentModel);
      const nc = [cm];
      applyCommitResult(nc, cm.id);
      save(msg.slice(0, 40), nc, cm.id, "main", pRef, newId);
    } catch (e) {
      if (e.code === "RATE_LIMIT") { setRateLimited(true); setPending(null); setThinking(false); return; }
      const cm = mkCommit(null, msg, "Error: " + e.message, "main");
      const nc = [cm];
      applyCommitResult(nc, cm.id);
      save(msg.slice(0, 40), nc, cm.id, "main", pRef, newId);
    } finally { setThinking(false); }
  };
  const sendEditRoot = async (msg) => {
    setEditId(null);
    const newId = "conv:" + Date.now();
    setCommits([]); cRef.current = [];
    setHeadId(null); setBranch("main"); setConvId(newId);
    setParentRef(null);
    save(msg.slice(0, 40), [], null, "main", null, newId);

    setPending(msg); setThinking(true);
    try {
      const resp = await callLLM(apiKey, [{ role: "user", content: msg }], currentModel, thinkingOn);
      const cm = mkCommit(null, msg, resp, "main", null, currentModel);
      const nc = [cm];
      applyCommitResult(nc, cm.id);
      save(msg.slice(0, 40), nc, cm.id, "main", null, newId);
    } catch (e) {
      if (e.code === "RATE_LIMIT") { setRateLimited(true); setPending(null); setThinking(false); return; }
      const cm = mkCommit(null, msg, "Error: " + e.message, "main");
      const nc = [cm];
      applyCommitResult(nc, cm.id);
    } finally { setThinking(false); }
  };
  const sendNormal = async (pid, br, msg) => {
    setPending(msg); setThinking(true);
    try {
      const th = getThread(cRef.current, pid);
      const msgs = buildMsgs(th, msg);
      const resp = await callLLM(apiKey, msgs, currentModel, thinkingOn);
      const cm = mkCommit(pid, msg, resp, br, null, currentModel);
      const nc = [...cRef.current, cm];
      applyCommitResult(nc, cm.id);
      save(msg.slice(0, 40), nc, cm.id, br);
    } catch (e) {
      if (e.code === "RATE_LIMIT") { setRateLimited(true); setPending(null); setThinking(false); return; }
      const cm = mkCommit(pid, msg, "Error: " + e.message, br);
      const nc = [...cRef.current, cm];
      applyCommitResult(nc, cm.id);
    } finally { setThinking(false); }
  };
  const send = async (forkBranch = false) => {
    if (!input.trim() || thinking) return;
    const msg = input.trim();

    // Slash commands
    if (msg === "/new" && headId) {
      setInput("");
      startNew(headId);
      return;
    }

    setInput("");
    let pid = headId, br = branch;

    // Auto-show graph on first message
    if (!graph && commits.length === 0) setGraph(true);

    if (newFromRef) { await sendNewFromRef(msg); return; }

    if (editId) {
      const ec = cRef.current.find(c => c.id === editId);
      if (ec) {
        if (!ec.parentId) { await sendEditRoot(msg); return; }
        pid = ec.parentId; br = "branch-" + names.length; setBranch(br);
      }
      setEditId(null); setGraph(true);
    }

    if (branchFromId) {
      const bc = cRef.current.find(c => c.id === branchFromId);
      if (bc) {
        pid = bc.id;
        br = "branch-" + names.length;
        setBranch(br);
      }
      setBranchFromId(null);
      setGraph(true);
    }

    if (forkBranch && headId) {
      br = "branch-" + names.length;
      setBranch(br);
    }

    await sendNormal(pid, br, msg);
  };

  // ─── HANDLERS ───
  const startEdit = cid => { const cm = commits.find(c => c.id === cid); if (!cm) return; setEditId(cid); setBranchFromId(null); setNewFromRef(null); setInput(cm.prompt); inputRef.current?.focus(); };
  const startBranchFrom = cid => {
    const cm = commits.find(c => c.id === cid);
    if (!cm) return;
    setHeadId(cm.id); setBranch(cm.branch); setScrollTarget(cm.id);
    setBranchFromId(cid); setEditId(null); setNewFromRef(null); setSelectMode(false); clearSelectRange(); setMm(false); setSel([]); setPending(null);
    setInput(""); inputRef.current?.focus();
  };
  const retryResponse = async (cid) => {
    const cm = cRef.current.find(c => c.id === cid);
    if (!cm || thinking) return;
    const parentId = cm.parentId || null;
    const br = nextBranchName(cRef.current);
    const parentThread = getThread(cRef.current, parentId);
    const msgs = buildMsgs(parentThread, cm.prompt);
    setHeadId(parentId); setBranch(br);
    setPending(cm.prompt); setThinking(true); setMm(false); setSel([]); setEditId(null); setBranchFromId(null); setNewFromRef(null);
    try {
      const resp = await callLLM(apiKey, msgs, currentModel, thinkingOn);
      const newCm = mkCommit(parentId, cm.prompt, resp, br, null, currentModel);
      const nc = [...cRef.current, newCm];
      setCommits(nc); cRef.current = nc; setHeadId(newCm.id); setScrollTarget(newCm.id);
      save(null, nc, newCm.id, br);
    } catch (e) {
      const newCm = mkCommit(parentId, cm.prompt, "Error: " + e.message, br, null, currentModel);
      const nc = [...cRef.current, newCm];
      setCommits(nc); cRef.current = nc; setHeadId(newCm.id);
      save(null, nc, newCm.id, br);
      if (e.code === "RATE_LIMIT") setRateLimited(true);
    } finally {
      setPending(null); setThinking(false);
    }
  };
  const copyToClipboard = (text) => { try { navigator.clipboard.writeText(text || ""); } catch {} };
  const checkout = (id, b) => { setHeadId(id); setBranch(b); setMm(false); setSel([]); setEditId(null); setBranchFromId(null); setPending(null); setNewFromRef(null); setScrollTarget(id); };
  const handleSelectNode = cid => {
    const cm = commits.find(c => c.id === cid);
    if (!cm) return;
    setSelectError("");
    setSelectRange(prev => {
      if (!prev.startId || prev.endId) return { startId: cid, endId: null };
      const start = commits.find(c => c.id === prev.startId);
      if (!start || start.branch !== cm.branch) {
        setSelectError("Same branch only");
        return { startId: cid, endId: null };
      }
      return { startId: prev.startId, endId: cid };
    });
  };
  const buildNewConvFromRange = (range, currentConv) => {
    const originalCommits = cutRangeFromCommits(cRef.current, range);
    const originalHead = chooseHeadAfterCut(originalCommits, headId, branch);
    const clusterId = currentConv.clusterId || mkClusterId();
    const originalUpdated = {
      ...currentConv,
      commits: originalCommits,
      headId: originalHead.headId,
      branch: originalHead.branch,
      clusterId,
      u: new Date().toISOString(),
    };

    const nc = cloneRangeCommits(range, "main", null);
    const newId = "conv:" + Date.now();
    const first = range[0], last = nc[nc.length - 1];
    const pRef = {
      convId,
      commitId: first.parentId || first.id,
      wasHead: first.id === headId,
      convTitle: currentConv?.title || "Untitled",
      promptSummary: first.prompt?.slice(0, 30) + (first.prompt?.length > 30 ? ".." : ""),
      anchorBranch: first.branch,
      branchPath: branchPathToRoot(commits, first.branch),
    };
    const createdAt = new Date().toISOString();
    touchCluster(clusterId, createdAt);
    const newConv = {
      id: newId,
      title: first.prompt?.slice(0, 40) || "Untitled",
      commits: nc,
      headId: last.id,
      branch: "main",
      parentRef: pRef,
      branchTitles: {},
      labels: [],
      clusterId,
      createdAt,
      u: createdAt,
    };
    return { originalUpdated, newConv, pRef, nc, last };
  };
  const rangeToNew = () => {
    const range = rangeCommitsFor(commits, selectRange);
    if (!range.length) return;
    const currentConv = convs.find(c => c.id === convId);
    if (!currentConv) return;
    rememberUndo("Moved to New");
    const { originalUpdated, newConv, pRef, nc, last } = buildNewConvFromRange(range, currentConv);
    storage.set(originalUpdated.id, JSON.stringify(originalUpdated));
    storage.set(newConv.id, JSON.stringify(newConv));
    setConvs(p => [newConv, originalUpdated, ...p.filter(c => c.id !== newConv.id && c.id !== originalUpdated.id)]);
    setSelectMode(false); clearSelectRange();
    setCommits(nc); cRef.current = nc; setHeadId(last.id); setBranch("main"); setConvId(newConv.id); setParentRef(pRef); setGraph(true);
  };
  const rangeToBranch = () => {
    const range = rangeCommitsFor(commits, selectRange);
    if (!range.length) return;
    const currentConv = convs.find(c => c.id === convId);
    if (!currentConv) return;
    rememberUndo("Moved to Branch");
    const originalCommits = cutRangeFromCommits(cRef.current, range);
    const br = nextBranchName(cRef.current);
    const nc = [...originalCommits, ...cloneRangeCommits(range, br, range[0].parentId || null)];
    const last = nc[nc.length - 1];
    const updated = { ...currentConv, commits: nc, headId: last.id, branch: br, u: new Date().toISOString() };
    storage.set(updated.id, JSON.stringify(updated));
    setConvs(p => [updated, ...p.filter(c => c.id !== updated.id)]);
    setSelectMode(false); clearSelectRange();
    setCommits(nc); cRef.current = nc; setHeadId(last.id); setBranch(br); setGraph(true);
  };
  const deleteRange = () => {
    const ids = new Set(selectedRangeIds);
    if (!ids.size) return;
    const currentConv = convs.find(c => c.id === convId);
    if (!currentConv) return;
    rememberUndo("Deleted selection");
    const range = rangeCommitsFor(commits, selectRange);
    const nc = cutRangeFromCommits(commits, range);
    const nextHead = chooseHeadAfterCut(nc, headId, branch);
    const updated = { ...currentConv, commits: nc, headId: nextHead.headId, branch: nextHead.branch, u: new Date().toISOString() };
    storage.set(updated.id, JSON.stringify(updated));
    setConvs(p => [updated, ...p.filter(c => c.id !== updated.id)]);
    setSelectMode(false); clearSelectRange();
    setCommits(nc); cRef.current = nc; setHeadId(nextHead.headId); setBranch(nextHead.branch);
  };

  const startNew = (cid) => {
    const cm = commits.find(c => c.id === cid);
    if (!cm) return;
    const currentConv = convs.find(c => c.id === convId);
    setBranchFromId(null); setSelectMode(false); clearSelectRange();
    setNewFromRef({
      convId, commitId: cid, wasHead: cid === headId,
      thread: getThread(commits, cid),
      anchorBranch: cm.branch,
      branchPath: branchPathToRoot(commits, cm.branch),
      convTitle: currentConv?.title || "Untitled",
      promptSummary: cm.prompt?.slice(0, 30) + (cm.prompt?.length > 30 ? ".." : ""),
    });
    setEditId(null); setMm(false); setSel([]);
    setInput(""); inputRef.current?.focus();
  };

  const goToParent = () => {
    if (!parentRef) return;
    const cv = convs.find(c => c.id === parentRef.convId);
    if (cv) { load(cv); setScrollTarget(parentRef.commitId); }
  };

  const goToChild = (childConvId) => {
    const cv = convs.find(c => c.id === childConvId);
    if (cv) load(cv);
  };

  const loadBranch = (cv, branchName) => {
    const leaf = bHead(cv.commits || [], branchName);
    load(cv);
    if (leaf) { setHeadId(leaf.id); setBranch(branchName); setScrollTarget(leaf.id); }
  };

  // Per-commit custom display label for the graph node. Empty clears it.
  // commit.prompt (conversation content) is never mutated.
  const renameTag = (oldName, newName) => {
    const trimmed = (newName || "").trim().replace(/^#+/, "");
    if (!trimmed || trimmed === oldName) return;
    const touched = [];
    const nextConvs = convs.map(cv => {
      let changed = false;
      const newCommits = (cv.commits || []).map(c => {
        if (!(c.tags || []).includes(oldName)) return c;
        changed = true;
        const merged = c.tags.map(tg => tg === oldName ? trimmed : tg);
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
  const deleteTag = (name) => {
    const touched = [];
    const nextConvs = convs.map(cv => {
      let changed = false;
      const newCommits = (cv.commits || []).map(c => {
        if (!(c.tags || []).includes(name)) return c;
        changed = true;
        const filtered = c.tags.filter(tg => tg !== name);
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

  const editCommitTags = (cid, tagsInput) => {
    const tags = (tagsInput || "")
      .split(",")
      .map(s => s.trim().replace(/^#+/, ""))
      .filter(Boolean);
    const newCommits = cRef.current.map(c => {
      if (c.id !== cid) return c;
      const { tags: _omit, ...rest } = c;
      return tags.length ? { ...rest, tags } : rest;
    });
    setCommits(newCommits); cRef.current = newCommits;
    save(null, newCommits, headId, branch);
  };

  const editNodeLabel = (cid, newLabel) => {
    const trimmed = (newLabel || "").trim();
    const existing = cRef.current.find(c => c.id === cid);
    if (!existing) return;
    const current = existing.displayLabel || "";
    if (trimmed === current) return;
    const newCommits = cRef.current.map(c => {
      if (c.id !== cid) return c;
      const { displayLabel, ...rest } = c;
      return trimmed ? { ...rest, displayLabel: trimmed } : rest;
    });
    setCommits(newCommits); cRef.current = newCommits;
    save(null, newCommits, headId, branch);
  };

  const collectDescendantIds = (allCommits, cid) => {
    const toDelete = new Set();
    const queue = [cid];
    while (queue.length) { const id = queue.shift(); toDelete.add(id); allCommits.filter(c => c.parentId === id).forEach(c => queue.push(c.id)); }
    return toDelete;
  };
  const pickNextHead = (nc, toDelete, cid, allCommits) => {
    let newHeadId = headId, newBranch = branch;
    const deleted = allCommits.find(c => c.id === cid);
    if (deleted?.parentId) { const parent = nc.find(c => c.id === deleted.parentId); if (parent) { newHeadId = parent.id; newBranch = parent.branch; } }
    if (!nc.find(c => c.id === newHeadId) || toDelete.has(newHeadId)) {
      if (nc.length > 0) { newHeadId = nc[nc.length - 1].id; newBranch = nc[nc.length - 1].branch; }
      else { newHeadId = null; newBranch = "main"; }
    }
    return { headId: newHeadId, branch: newBranch };
  };
  const deleteCommit = (cid) => {
    rememberUndo("Deleted commit");
    const toDelete = collectDescendantIds(commits, cid);
    const nc = commits.filter(c => !toDelete.has(c.id));
    setCommits(nc); cRef.current = nc;
    if (nc.length === 0 && convId) {
      del(convId);
      return;
    }
    let newHeadId = headId, newBranch = branch;
    if (toDelete.has(headId)) {
      ({ headId: newHeadId, branch: newBranch } = pickNextHead(nc, toDelete, cid, commits));
      setHeadId(newHeadId); setBranch(newBranch);
    }
    const existingConv = convs.find(c => c.id === convId);
    save(existingConv?.title, nc, newHeadId, newBranch);
  };

  const merge = async () => {
    if (!input.trim() || !sel.length) return;
    const msg = input.trim(); setInput(""); setMm(false); setPending(msg); setThinking(true);
    try {
      const curTh = getThread(cRef.current, headId).map(c => "User: " + c.prompt + "\nAI: " + c.response).join("\n\n");
      const selCtx = sel.map(sid => { const sc = cRef.current.find(c => c.id === sid); if (!sc) return ""; return "[" + sc.branch + "]:\n" + getThread(cRef.current, sid).map(c => "User: " + c.prompt + "\nAI: " + c.response).join("\n\n"); }).join("\n---\n");
      const resp = await callLLM(apiKey, [{ role: "user", content: "Merge:\n\nCurrent (" + branch + "):\n" + curTh + "\n\nSelected:\n" + selCtx + "\n\nInstruction:\n" + msg }], currentModel, thinkingOn);
      const cm = mkCommit(headId, msg, resp, branch, sel, currentModel);
      const nc = [...cRef.current, cm]; setCommits(nc); cRef.current = nc; setHeadId(cm.id); setSel([]); setPending(null);
      save(null, nc, cm.id, branch);
    } catch (e) {
      if (e.code === "RATE_LIMIT") { setRateLimited(true); setPending(null); setSel([]); setThinking(false); return; }
      const cm = mkCommit(headId, msg, "Merge error: " + e.message, branch);
      const nc = [...cRef.current, cm]; setCommits(nc); cRef.current = nc; setHeadId(cm.id); setSel([]); setPending(null);
    } finally { setThinking(false); }
  };

  /* RENDER */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((v) => !v);

  const sidebarProps = {
    convs, clusters, clusterGroups, convId, branch,
    activeTags, setActiveTags, renameTag, deleteTag,
    chatMenu, setChatMenu,
    renamingId, setRenamingId,
    renamingBranch, setRenamingBranch,
    renamingClusterId, setRenamingClusterId,
    renameVal, setRenameVal,
    expandedClusters, toggleCluster, expandFolder,
    sidebarItemOpen, toggleSidebarItem,
    activeFolderId, setActiveFolderId,
    createFolder, renameFolder, deleteFolder,
    moveConvToFolder, moveFolder,
    apiKey, setApiKey, showKeyInput, setShowKeyInput,
    keyDraft, setKeyDraft, hasKey, setRateLimited,
    newConv, loadMain, loadBranch,
    renameConv, renameBranch, del, countChildConvs, deleteBranchCascade,
    setConfirmDialog,
    collapsed: sidebarCollapsed,
    toggleSidebar,
  };

  const chatProps = {
    commits, headId, branch, names, parentRef, thread,
    convs, convId, activeTags,
    input, setInput, inputRef, endRef,
    pending, thinking, newFromRef, setNewFromRef,
    editId, setEditId, startEdit,
    branchFromId, setBranchFromId,
    mm, setMm, sel, setSel,
    hoveredCid, setHoveredCid,
    graph, setGraph, graphW, setGraphW, dragging,
    modelList, currentModel, setModel, thinkingOn, setThinkingOn,
    selectMode, setSelectMode, selectError, selectRange, selectedRangeIds, clearSelectRange,
    undoAction, setUndoAction, restoreUndo,
    rateLimited, hasKey,
    waitlistStatus, setWaitlistStatus, waitlistEmail, setWaitlistEmail,
    apiKey, setKeyDraft, setShowKeyInput, setRateLimited,
    send, merge,
    copyToClipboard, retryResponse,
    checkout, startBranchFrom, startNew, deleteCommit,
    goToParent, goToChild, childRefs,
    handleSelectNode, rangeToBranch, rangeToNew, deleteRange,
    editNodeLabel, editCommitTags,
  };

  return (
    <SidebarProvider defaultOpen>
      <AlertDialog open={!!confirmDialog} onOpenChange={(o: boolean) => !o && setConfirmDialog(null)}>
        <div className="flex h-svh w-full">
          {sidebarCollapsed && (
            <aside className="flex h-full w-14 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
              <AppSidebar {...sidebarProps} />
            </aside>
          )}
          <div className="flex min-w-0 flex-1">
            <ResizablePanelGroup direction="horizontal" autoSaveId="ob:layout">
              {!sidebarCollapsed && (
                <>
                  <ResizablePanel
                    defaultSize={17}
                    minSize={10}
                    maxSize={38}
                  >
                    <aside className="flex h-full min-w-0 flex-col overflow-hidden border-r bg-sidebar text-sidebar-foreground">
                      <AppSidebar {...sidebarProps} />
                    </aside>
                  </ResizablePanel>
                  <ResizableHandle title="Drag to resize" />
                </>
              )}
              <ResizablePanel minSize={40}>
                <ChatPanel {...chatProps} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap">
              {confirmDialog?.msg}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { confirmDialog?.onConfirm?.(); setConfirmDialog(null); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}
