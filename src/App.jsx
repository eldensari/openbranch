import { useState, useRef, useEffect } from "react";
import storage from "./lib/storage";
import { callLLM, detectProvider, submitWaitlist, MODEL_CHOICES } from "./lib/llm";
import herbIcon from "./assets/herb.svg";
import { LIGHT, DARK, bCol } from "./theme";
import { mkCommit, buildMsgs, getThread, bNames, bHead, shortModelName, bumpIdCounter } from "./graph/model";
import { getBranchLabel, buildBranchTree, commitBranch, branchPathToRoot, getBranchDescendantNames } from "./graph/branches";
import { rangeCommitsFor, cutRangeFromCommits, chooseHeadAfterCut, cloneRangeCommits, nextBranchName } from "./graph/range";
import { formatClusterTitle, mkClusterId, getConvCreatedAt, buildClusterGroups } from "./storage/clusters";
import { sidebarBranchKey, buildSidebarLayout } from "./storage/sidebar";
import { loadAllConvsAndClusters, persistConv, persistCluster, deleteConvCascade } from "./storage/conv";
import { renderMd, ThinkingDots } from "./ui/Markdown";
import IconBtn from "./ui/IconBtn";
import ModelPicker from "./ui/ModelPicker";
import Graph from "./ui/Graph";
import ConfirmDialog from "./ui/ConfirmDialog";
import Sidebar from "./ui/Sidebar";

/* ═══════ MAIN ═══════ */
export default function App() {
  const [dark, setDark] = useState(() => storage.get("theme")?.value === "dark");
  const t = dark ? DARK : LIGHT;

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
  const [collapsedClusters, setCollapsedClusters] = useState(() => new Set());
  const [openSidebarItems, setOpenSidebarItems] = useState(() => new Set());
  const [closedSidebarItems, setClosedSidebarItems] = useState(() => new Set());
  const [renameVal, setRenameVal] = useState("");
  const dragging = useRef(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const cRef = useRef(commits); cRef.current = commits;
  const sendRef = useRef(null);

  // Persist theme
  useEffect(() => { storage.set("theme", dark ? "dark" : "light"); }, [dark]);

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
      cluster = { id: clusterId, title: formatClusterTitle(createdAt || now), createdAt: createdAt || now, u: createdAt || now };
    }
    persistCluster(cluster);
    setClusters(p => [...p.filter(c => c.id !== cluster.id), cluster]);
    return cluster;
  };

  const save = (title, cm, hid, br, pRef, forceNewId) => {
    const id = forceNewId || convId || "conv:" + Date.now();
    // `convs` state can be a stale closure snapshot inside async flows
    // (e.g., the second save() in the newFromRef branch runs after await callLLM
    // and doesn't see the first save()'s addition). Fall back to storage so
    // cluster/title/branchTitles from the prior save are preserved.
    let existing = convs.find(c => c.id === id);
    if (!existing) {
      const stored = storage.get(id);
      if (stored?.value) { try { existing = JSON.parse(stored.value); } catch {} }
    }
    const parentConv = pRef?.convId ? convs.find(c => c.id === pRef.convId) : null;
    const currentConv = convs.find(c => c.id === convId);
    const createdAt = existing?.createdAt || new Date().toISOString();
    const clusterId = existing?.clusterId || parentConv?.clusterId || currentConv?.clusterId || mkClusterId();
    touchCluster(clusterId, createdAt);
    const finalTitle = existing?.title || title || (cm.length > 0 ? cm[0].prompt?.slice(0, 40) : "Untitled");
    const cv = { id, title: finalTitle, commits: cm, headId: hid, branch: br, parentRef: pRef || parentRef || null, branchTitles: existing?.branchTitles || {}, labels: existing?.labels || [], clusterId, createdAt, u: new Date().toISOString() };
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
  const deleteBranchCascade = (cvId, bName) => {
    const cv = convs.find(c => c.id === cvId);
    if (!cv) return;
    rememberUndo("Deleted branch");
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
    const updated = { ...cluster, title: trimmed || formatClusterTitle(cluster.createdAt) };
    storage.set(id, JSON.stringify(updated));
    setClusters(p => p.map(c => c.id === id ? updated : c));
  };
  const toggleCluster = (id) => {
    setCollapsedClusters(p => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
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

    if (newFromRef) {
      const pRef = { convId: newFromRef.convId, commitId: newFromRef.commitId, wasHead: newFromRef.wasHead !== false, convTitle: newFromRef.convTitle, promptSummary: newFromRef.promptSummary, anchorBranch: newFromRef.anchorBranch };
      const newId = "conv:" + Date.now();
      if (newFromRef.anchorBranch && newFromRef.anchorBranch !== "main") {
        setOpenSidebarItems(p => {
          const n = new Set(p);
          (newFromRef.branchPath || [newFromRef.anchorBranch]).forEach(b => n.add(sidebarBranchKey(newFromRef.convId, b)));
          return n;
        });
      }

      setCommits([]); cRef.current = [];
      setHeadId(null); setBranch("main"); setConvId(newId);
      setParentRef(pRef); setNewFromRef(null); setGraph(true);
      save(msg.slice(0, 40), [], null, "main", pRef, newId);

      setPending(msg); setThinking(true);
      try {
        const msgs = buildMsgs(newFromRef.thread || [], msg);
        const resp = await callLLM(apiKey, msgs, currentModel, thinkingOn);
        const cm = mkCommit(null, msg, resp, "main", null, currentModel);
        const nc = [cm];
        setCommits(nc); cRef.current = nc; setHeadId(cm.id); setPending(null);
        save(msg.slice(0, 40), nc, cm.id, "main", pRef, newId);
      } catch (e) {
        if (e.code === "RATE_LIMIT") { setRateLimited(true); setPending(null); setThinking(false); return; }
        const cm = mkCommit(null, msg, "Error: " + e.message, "main");
        const nc = [cm];
        setCommits(nc); cRef.current = nc; setHeadId(cm.id); setPending(null);
        save(msg.slice(0, 40), nc, cm.id, "main", pRef, newId);
      } finally { setThinking(false); }
      return;
    }

    if (editId) {
      const ec = cRef.current.find(c => c.id === editId);
      if (ec) {
        if (!ec.parentId) {
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
            setCommits(nc); cRef.current = nc; setHeadId(cm.id); setPending(null);
            save(msg.slice(0, 40), nc, cm.id, "main", null, newId);
          } catch (e) {
            if (e.code === "RATE_LIMIT") { setRateLimited(true); setPending(null); setThinking(false); return; }
            const cm = mkCommit(null, msg, "Error: " + e.message, "main");
            const nc = [cm];
            setCommits(nc); cRef.current = nc; setHeadId(cm.id); setPending(null);
          } finally { setThinking(false); }
          return;
        }
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

    setPending(msg); setThinking(true);
    try {
      const th = getThread(cRef.current, pid);
      const msgs = buildMsgs(th, msg);
      const resp = await callLLM(apiKey, msgs, currentModel, thinkingOn);
      const cm = mkCommit(pid, msg, resp, br, null, currentModel);
      const nc = [...cRef.current, cm]; setCommits(nc); cRef.current = nc; setHeadId(cm.id); setPending(null);
      save(msg.slice(0, 40), nc, cm.id, br);
    } catch (e) {
      if (e.code === "RATE_LIMIT") { setRateLimited(true); setPending(null); setThinking(false); return; }
      const cm = mkCommit(pid, msg, "Error: " + e.message, br);
      const nc = [...cRef.current, cm]; setCommits(nc); cRef.current = nc; setHeadId(cm.id); setPending(null);
    } finally { setThinking(false); }
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
  const toggleSel = id => setSel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
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
  const rangeToNew = () => {
    const range = rangeCommitsFor(commits, selectRange);
    if (!range.length) return;
    const currentConv = convs.find(c => c.id === convId);
    if (!currentConv) return;
    rememberUndo("Moved to New");

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
    storage.set(originalUpdated.id, JSON.stringify(originalUpdated));
    storage.set(newId, JSON.stringify(newConv));
    setConvs(p => [newConv, originalUpdated, ...p.filter(c => c.id !== newId && c.id !== originalUpdated.id)]);
    setSelectMode(false); clearSelectRange();
    setCommits(nc); cRef.current = nc; setHeadId(last.id); setBranch("main"); setConvId(newId); setParentRef(pRef); setGraph(true);
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

  const deleteCommit = (cid) => {
    rememberUndo("Deleted commit");
    const toDelete = new Set();
    const queue = [cid];
    while (queue.length) { const id = queue.shift(); toDelete.add(id); commits.filter(c => c.parentId === id).forEach(c => queue.push(c.id)); }
    const nc = commits.filter(c => !toDelete.has(c.id));
    setCommits(nc); cRef.current = nc;
    if (nc.length === 0 && convId) {
      del(convId);
      return;
    }
    let newHeadId = headId, newBranch = branch;
    if (toDelete.has(headId)) {
      const deleted = commits.find(c => c.id === cid);
      if (deleted?.parentId) { const parent = nc.find(c => c.id === deleted.parentId); if (parent) { newHeadId = parent.id; newBranch = parent.branch; } }
      if (!nc.find(c => c.id === newHeadId) || toDelete.has(newHeadId)) {
        if (nc.length > 0) { newHeadId = nc[nc.length - 1].id; newBranch = nc[nc.length - 1].branch; }
        else { newHeadId = null; newBranch = "main"; }
      }
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
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: t.bg, color: t.text }}>
      <Sidebar
        t={t} dark={dark} setDark={setDark}
        convs={convs} clusters={clusters} clusterGroups={clusterGroups}
        convId={convId} branch={branch}
        activeTags={activeTags} setActiveTags={setActiveTags}
        chatMenu={chatMenu} setChatMenu={setChatMenu}
        renamingId={renamingId} setRenamingId={setRenamingId}
        renamingBranch={renamingBranch} setRenamingBranch={setRenamingBranch}
        setRenamingClusterId={setRenamingClusterId}
        renameVal={renameVal} setRenameVal={setRenameVal}
        collapsedClusters={collapsedClusters} toggleCluster={toggleCluster}
        sidebarItemOpen={sidebarItemOpen} toggleSidebarItem={toggleSidebarItem}
        apiKey={apiKey} setApiKey={setApiKey}
        showKeyInput={showKeyInput} setShowKeyInput={setShowKeyInput}
        keyDraft={keyDraft} setKeyDraft={setKeyDraft}
        hasKey={hasKey} setRateLimited={setRateLimited}
        newConv={newConv} loadMain={loadMain} loadBranch={loadBranch}
        renameConv={renameConv} renameBranch={renameBranch}
        del={del} countChildConvs={countChildConvs} deleteBranchCascade={deleteBranchCascade}
        setConfirmDialog={setConfirmDialog}
      />

      {/* CENTER */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "7px 12px", borderBottom: "0.5px solid " + t.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.text, display: "flex", alignItems: "center", gap: 6 }}><img src={herbIcon} alt="" style={{ width: 20, height: 20 }} /> OpenBranch</span>
            {names.length > 0 && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: bCol(names, branch) + "18", color: bCol(names, branch), fontWeight: 500, fontFamily: "monospace" }}>{branch}</span>}
            {parentRef && <span onClick={goToParent} style={{ fontSize: 8, color: "#378ADD", cursor: "pointer" }}>{"\u2197"} from: {parentRef.convTitle?.slice(0, 20)}</span>}
          </div>
          {commits.length > 0 && <button onClick={() => setGraph(!graph)} style={{ fontSize: 9, padding: "4px 8px", borderRadius: 4, cursor: "pointer", background: graph ? t.accent : "transparent", color: graph ? t.accentText : t.textSub, border: graph ? "none" : "0.5px solid " + t.border }}>{graph ? "Hide graph" : "Graph"}</button>}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 32px", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
          <div style={{ width: "100%", maxWidth: 760, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          {thread.length === 0 && !pending && !newFromRef && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 28 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px", color: t.text, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><img src={herbIcon} alt="OpenBranch" style={{ width: 36, height: 36 }} /> OpenBranch</div>
                <div style={{ fontSize: 13, color: t.textSub, marginTop: 6 }}>Expand your chat. Merge your ideas.</div>
              </div>
              <div style={{ width: "100%", maxWidth: 680, borderRadius: 18, border: "0.5px solid " + t.border, background: t.bg, padding: "14px 16px 10px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
                <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (e.metaKey || e.ctrlKey) { send(true); return; } send(false); } }}
                  placeholder="How can I help you today?"
                  rows={1}
                  style={{ width: "100%", boxSizing: "border-box", padding: "6px 0 14px", fontSize: 14, border: "none", outline: "none", background: "transparent", color: t.text, resize: "none", fontFamily: "inherit", lineHeight: 1.5, maxHeight: 200, overflowY: "auto" }}
                  onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; }} />
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                  <ModelPicker models={modelList} value={currentModel} onChange={v => { setModel(v); storage.set("model", v); }} thinking={thinkingOn} onThinkingChange={v => { setThinkingOn(v); storage.set("thinkingOn", v ? "1" : "0"); }} t={t} />
                </div>
              </div>
            </div>
          )}
          {thread.map(cm => {
            const isMrg = (cm.mergeIds || []).length > 0;
            return (
              <div key={cm.id} id={"cm-" + cm.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}
                onMouseEnter={() => setHoveredCid(cm.id)} onMouseLeave={() => setHoveredCid(null)}>
                <div style={{ alignSelf: "flex-end", maxWidth: "80%" }}>
                  <div style={{ padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", background: isMrg ? t.mergeBubble : t.userBubble, color: isMrg ? t.mergeText : t.userText, borderLeft: isMrg ? "3px solid #BA7517" : "none" }}>
                    {isMrg && <div style={{ fontSize: 9, fontWeight: 600, marginBottom: 4, color: "#BA7517" }}>MERGE</div>}
                    {cm.prompt}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
                    <button onClick={() => startEdit(cm.id)} style={{ fontSize: 9, color: editId === cm.id ? t.userText : t.textMuted, background: "none", border: "none", cursor: "pointer", padding: "1px 4px" }}
                      onMouseEnter={e => e.currentTarget.style.color = t.userText} onMouseLeave={e => { if (editId !== cm.id) e.currentTarget.style.color = t.textMuted; }}>edit</button>
                  </div>
                </div>
                <div style={{ alignSelf: "flex-start", maxWidth: "80%", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.7, background: t.aiBubble, color: t.aiText }}>{renderMd(cm.response, t)}</div>
                  <div className="ai-actions" style={{ display: "flex", gap: 2, opacity: 0.45, transition: "opacity 0.15s", marginLeft: 4 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "1"} onMouseLeave={e => e.currentTarget.style.opacity = "0.45"}>
                    <IconBtn title="Copy" t={t} onClick={() => copyToClipboard(cm.response)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="11" height="11" rx="2" />
                        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                      </svg>
                    </IconBtn>
                    <IconBtn title="Retry" t={t} onClick={() => retryResponse(cm.id)} disabled={thinking}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
                        <path d="M21 3v5h-5" />
                        <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
                        <path d="M3 21v-5h5" />
                      </svg>
                    </IconBtn>
                  </div>
                </div>
              </div>
            );
          })}
          {pending && <div style={{ alignSelf: "flex-end", maxWidth: "80%", padding: "10px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.7, background: newFromRef ? "#f0f6ff" : t.userBubble, color: newFromRef ? "#378ADD" : t.userText }}>{pending}</div>}
          {thinking && <div style={{ padding: "10px 14px", borderRadius: 12, background: t.aiBubble, fontSize: 13, color: t.textMuted, alignSelf: "flex-start" }}><ThinkingDots /></div>}
          <div ref={endRef} />
          </div>
        </div>

        {/* Mode indicators */}
        {branchFromId && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: t.userBubble, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: t.userText, fontWeight: 500 }}>Branch from selected point</span>
          <button onClick={() => { setBranchFromId(null); setInput(""); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
        </div>}
        {editId && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: t.userBubble, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: t.userText, fontWeight: 500 }}>Editing — new branch</span>
          <button onClick={() => { setEditId(null); setInput(""); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
        </div>}
        {newFromRef && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: "#f0f6ff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#378ADD", fontWeight: 500 }}>New conversation from {newFromRef.promptSummary?.slice(0, 25)}..</span>
          <button onClick={() => { setNewFromRef(null); setInput(""); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
        </div>}
        {mm && sel.length > 0 && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: t.mergeBubble, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: t.mergeText, fontWeight: 500 }}>Merging {sel.length} into {branch}</span>
          <button onClick={() => { setMm(false); setSel([]); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
        </div>}
        {undoAction && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: dark ? "#122033" : "#EAF3FF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: dark ? "#9CCBFF" : "#1F6FB2", fontWeight: 500 }}>{undoAction.label}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={restoreUndo} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + (dark ? "#33567A" : "#A8CFFF"), cursor: "pointer", color: dark ? "#C7E2FF" : "#1F6FB2" }}>Undo</button>
            <button onClick={() => setUndoAction(null)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: dark ? "#1F6FB2" : "#378ADD", border: "0.5px solid " + (dark ? "#2E7FC9" : "#378ADD"), cursor: "pointer", color: "#fff" }}>Done</button>
          </div>
        </div>}

        {/* Rate limit banner */}
        {rateLimited && !hasKey && (
          <div style={{ padding: "10px 14px", borderTop: "0.5px solid " + t.border, background: dark ? "#2a1a0e" : "#fef9ef" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: dark ? "#f0c060" : "#854F0B", marginBottom: 6 }}>
              You've reached the free message limit. Enter your API key to continue, or leave your email for updates.
            </div>
            {waitlistStatus === "done" ? (
              <div style={{ fontSize: 11, color: "#1D9E75", fontWeight: 500 }}>{"\u2713"} You're on the list! We'll reach out soon.</div>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <input value={waitlistEmail} onChange={e => setWaitlistEmail(e.target.value)}
                  placeholder="your@email.com"
                  onKeyDown={e => { if (e.key === "Enter" && waitlistEmail.trim()) {
                    setWaitlistStatus("sending");
                    submitWaitlist(waitlistEmail.trim()).then(r => setWaitlistStatus(r.ok ? "done" : "error")).catch(() => setWaitlistStatus("error"));
                  }}}
                  style={{ flex: 1, padding: "6px 8px", fontSize: 11, borderRadius: 6, border: "0.5px solid " + t.border, background: t.bg, color: t.text }} />
                <button onClick={() => {
                    if (!waitlistEmail.trim()) return;
                    setWaitlistStatus("sending");
                    submitWaitlist(waitlistEmail.trim()).then(r => setWaitlistStatus(r.ok ? "done" : "error")).catch(() => setWaitlistStatus("error"));
                  }}
                  disabled={waitlistStatus === "sending" || !waitlistEmail.trim()}
                  style={{ padding: "6px 12px", fontSize: 11, fontWeight: 500, borderRadius: 6, background: t.accent, color: t.accentText, border: "none", cursor: "pointer", opacity: waitlistStatus === "sending" ? 0.5 : 1 }}>
                  {waitlistStatus === "sending" ? "..." : "Notify me"}
                </button>
              </div>
            )}
            {waitlistStatus === "error" && <div style={{ fontSize: 10, color: "#c00", marginTop: 4 }}>Something went wrong. Try again.</div>}
            <button onClick={() => { setKeyDraft(apiKey); setShowKeyInput(true); setRateLimited(false); }}
              style={{ fontSize: 10, color: t.textSub, background: "none", border: "none", cursor: "pointer", marginTop: 6, padding: 0, textDecoration: "underline" }}>
              Enter API key instead
            </button>
          </div>
        )}

        {/* Input (bottom) — hidden during empty state since input is centered there */}
        {(thread.length > 0 || pending || newFromRef) && (
          <div style={{ padding: "4px 16px 18px", display: "flex", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: 760, borderRadius: 16, border: (branchFromId || editId) ? "1.5px solid " + t.userText : newFromRef ? "1.5px solid #378ADD" : mm ? "1.5px solid #BA7517" : "0.5px solid " + t.border, background: t.bg, padding: "10px 14px 8px", boxShadow: "0 1px 6px rgba(0,0,0,0.04)" }}>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (mm && sel.length) { merge(); return; }
                    if (e.metaKey || e.ctrlKey) { send(true); return; }
                    send(false);
                  }
                }}
                placeholder={branchFromId ? "Write the first message for this branch..." : editId ? "Edit your question..." : newFromRef ? "Start new conversation..." : mm ? "Merge instruction..." : "Reply..."}
                rows={1}
                style={{ width: "100%", boxSizing: "border-box", padding: "4px 0 10px", fontSize: 13, border: "none", outline: "none", background: "transparent", color: t.text, resize: "none", fontFamily: "inherit", lineHeight: 1.5, maxHeight: 200, overflowY: "auto" }}
                onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px"; }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div />
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ModelPicker models={modelList} value={currentModel} onChange={v => { setModel(v); storage.set("model", v); }} thinking={thinkingOn} onThinkingChange={v => { setThinkingOn(v); storage.set("thinkingOn", v ? "1" : "0"); }} t={t} />
                  <button onClick={() => mm && sel.length ? merge() : send()} disabled={thinking || !input.trim() || (mm && !sel.length)}
                    style={{ padding: "6px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8, background: (branchFromId || editId) ? t.userText : newFromRef ? "#378ADD" : mm ? "#854F0B" : t.accent, color: t.accentText, border: "none", cursor: "pointer", opacity: thinking || !input.trim() ? 0.4 : 1 }}>
                    {branchFromId ? "Branch" : editId ? "Edit" : mm ? "Merge" : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: Graph */}
      {graph && commits.length > 0 && (
        <div style={{ width: graphW, minWidth: 200, maxWidth: 600, display: "flex", flexDirection: "column", borderLeft: "0.5px solid " + t.border, background: t.graphBg, overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 10 }}
            onMouseDown={e => {
              e.preventDefault(); dragging.current = true;
              const startX = e.clientX, startW = graphW;
              const onMove = ev => { if (dragging.current) setGraphW(Math.max(200, Math.min(600, startW - (ev.clientX - startX)))); };
              const onUp = () => { dragging.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
              document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
            }} />
          <div style={{ padding: "7px 8px", borderBottom: "0.5px solid " + t.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 500, color: t.textSub }}>Graph</span>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 8, color: t.textMuted, fontFamily: "monospace" }}>HEAD {headId?.slice(0, 7)}</span>
              {!mm && <button onClick={() => { setSelectMode(p => !p); setMm(false); setSel([]); clearSelectRange(); }}
                style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: selectMode ? "#378ADD" : "transparent", color: selectMode ? "#fff" : "#378ADD", border: "0.5px solid #378ADD", cursor: "pointer" }}>Select</button>}
              {names.length > 1 && !mm && !selectMode && <button onClick={() => { setSelectMode(false); clearSelectRange(); setMm(true); setSel([]); }} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#FAEEDA", color: "#854F0B", border: "0.5px solid #FAC775", cursor: "pointer" }}>Merge</button>}
              {mm && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: "#854F0B", color: "#fff" }}>Select commits</span>}
              {selectMode && <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, background: selectError ? "#fee" : "#EAF3FF", color: selectError ? "#c00" : "#1F6FB2" }}>{selectError || (selectRange.endId ? selectedRangeIds.length + " selected" : selectRange.startId ? "Pick end" : "Pick start")}</span>}
            </div>
          </div>
          <Graph commits={commits} headId={headId} activeBranch={branch} names={names} onCheckout={checkout} onBranch={startBranchFrom} onNew={startNew} onDelete={deleteCommit} mergeMode={mm} selected={sel} onToggleSel={toggleSel} selectMode={selectMode} selectedRangeIds={selectedRangeIds} onSelectNode={handleSelectNode} onRangeBranch={rangeToBranch} onRangeNew={rangeToNew} onRangeDelete={deleteRange} parentRef={parentRef} onGoToParent={goToParent} childRefs={childRefs} onGoToChild={goToChild} hoveredCid={hoveredCid} panelW={graphW} t={t} branchTitles={convs.find(c => c.id === convId)?.branchTitles || {}} onEditLabel={editNodeLabel} onEditTags={editCommitTags} allTags={Array.from(new Set(convs.flatMap(cv => (cv.commits || []).flatMap(c => c.tags || []))))} />
        </div>
      )}

      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} t={t} />
    </div>
  );
}
