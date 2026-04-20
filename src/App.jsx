import { useState, useRef, useEffect } from "react";
import storage from "./lib/storage";
import { callLLM, detectProvider, submitWaitlist, MODEL_CHOICES } from "./lib/llm";
import herbIcon from "./assets/herb.svg";
import seedMobyDick from "./seed-moby-dick";
import { LIGHT, DARK, bCol } from "./theme";
import { mkCommit, buildMsgs, getThread, bNames, bHead, shortModelName, bumpIdCounter } from "./graph/model";
import { getBranchLabel, buildBranchTree, commitBranch, branchPathToRoot, getBranchDescendantNames } from "./graph/branches";
import { rangeCommitsFor, cutRangeFromCommits, chooseHeadAfterCut, cloneRangeCommits, nextBranchName } from "./graph/range";

/* ═══════ MARKDOWN ═══════ */
function renderInline(text, keyRef, t) {
  const parts = [];
  const regex = /(\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|~~(.+?)~~|https?:\/\/[^\s)]+)/g;
  let lastIdx = 0, match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx, match.index)}</span>);
    if (match[2] && match[3]) parts.push(<a key={keyRef.k++} href={match[3]} target="_blank" rel="noopener noreferrer" style={{ color: "#378ADD", textDecoration: "underline" }}>{match[2]}</a>);
    else if (match[4]) parts.push(<strong key={keyRef.k++}>{match[4]}</strong>);
    else if (match[5]) parts.push(<em key={keyRef.k++}>{match[5]}</em>);
    else if (match[6]) parts.push(<code key={keyRef.k++} style={{ background: t.inlineCode, padding: "1px 4px", borderRadius: 3, fontSize: "0.9em", fontFamily: "monospace" }}>{match[6]}</code>);
    else if (match[7]) parts.push(<span key={keyRef.k++} style={{ textDecoration: "line-through", opacity: 0.7 }}>{match[7]}</span>);
    else if (match[0].startsWith("http")) parts.push(<a key={keyRef.k++} href={match[0]} target="_blank" rel="noopener noreferrer" style={{ color: "#378ADD", textDecoration: "underline" }}>{match[0]}</a>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={keyRef.k++}>{text.slice(lastIdx)}</span>);
  return parts;
}

function CodeBlock({ lang, code, t }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => { try { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch {} };
  return (
    <div style={{ position: "relative", margin: "6px 0" }}>
      {lang && <div style={{ position: "absolute", top: 6, left: 10, fontSize: 9, color: t.textMuted, fontFamily: "monospace", textTransform: "lowercase" }}>{lang}</div>}
      <button onClick={doCopy} title={copied ? "Copied" : "Copy"}
        style={{ position: "absolute", top: 4, right: 4, padding: "3px 7px", fontSize: 9, borderRadius: 4, background: "transparent", border: "0.5px solid " + t.border, color: copied ? "#1D9E75" : t.textMuted, cursor: "pointer" }}>
        {copied ? "\u2713" : "copy"}
      </button>
      <pre style={{ background: t.codeBg, color: t.codeText, padding: lang ? "22px 12px 10px" : "10px 12px", borderRadius: 8, fontSize: 12, lineHeight: 1.5, overflowX: "auto", fontFamily: "monospace", margin: 0 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderMd(text, t) {
  if (!text) return null;
  const kr = { k: 0 };
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++;
      elements.push(<CodeBlock key={kr.k++} lang={lang} code={codeLines.join("\n")} t={t} />);
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<div key={kr.k++} style={{ height: 1, background: t.border, margin: "12px 0" }} />);
      i++; continue;
    }
    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith("> ")) { quoteLines.push(lines[i].slice(2)); i++; }
      elements.push(
        <div key={kr.k++} style={{ borderLeft: "3px solid " + t.border, paddingLeft: 10, margin: "6px 0", color: t.textSub, fontStyle: "italic" }}>
          {quoteLines.map((q, idx) => <div key={idx} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(q, kr, t)}</div>)}
        </div>
      );
      continue;
    }
    // Markdown table: header row of | cells |, separator of | --- |, then rows
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\|\s*[-:| ]+\s*\|?\s*$/.test(lines[i + 1])) {
      const parseRow = s => s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const header = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(parseRow(lines[i])); i++; }
      elements.push(
        <div key={kr.k++} style={{ overflowX: "auto", margin: "6px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "auto" }}>
            <thead><tr>{header.map((h, idx) => <th key={idx} style={{ border: "0.5px solid " + t.border, padding: "6px 10px", background: t.hoverSidebar, textAlign: "left", fontWeight: 600 }}>{renderInline(h, kr, t)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ border: "0.5px solid " + t.border, padding: "5px 10px" }}>{renderInline(c, kr, t)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (line.startsWith("### ")) { elements.push(<div key={kr.k++} style={{ fontSize: 13, fontWeight: 700, margin: "10px 0 4px" }}>{renderInline(line.slice(4), kr, t)}</div>); i++; continue; }
    if (line.startsWith("## ")) { elements.push(<div key={kr.k++} style={{ fontSize: 14, fontWeight: 700, margin: "12px 0 4px" }}>{renderInline(line.slice(3), kr, t)}</div>); i++; continue; }
    if (line.startsWith("# ")) { elements.push(<div key={kr.k++} style={{ fontSize: 16, fontWeight: 700, margin: "14px 0 4px" }}>{renderInline(line.slice(2), kr, t)}</div>); i++; continue; }
    if (/^[-*] /.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(lines[i].slice(2)); i++; }
      elements.push(<ul key={kr.k++} style={{ margin: "4px 0", paddingLeft: 20 }}>{items.map(it => <li key={kr.k++} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(it, kr, t)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\. /, "")); i++; }
      elements.push(<ol key={kr.k++} style={{ margin: "4px 0", paddingLeft: 20 }}>{items.map(it => <li key={kr.k++} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(it, kr, t)}</li>)}</ol>);
      continue;
    }
    if (line.trim() === "") { elements.push(<div key={kr.k++} style={{ height: 6 }} />); i++; continue; }
    elements.push(<div key={kr.k++} style={{ fontSize: 13, lineHeight: 1.7 }}>{renderInline(line, kr, t)}</div>);
    i++;
  }
  return elements;
}

/* ═══════ THINKING DOTS ═══════ */
function ThinkingDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const interval = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400);
    return () => clearInterval(interval);
  }, []);
  return <span>Thinking{dots}<span style={{ visibility: "hidden" }}>{"...".slice(dots.length)}</span></span>;
}

/* ═══════ ICONS ═══════ */
const SunIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);
const MoonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);
const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);
const FolderIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <path d="M3 6.5v-1A1.5 1.5 0 0 1 4.5 4h4.2l2 2.5"/>
  </svg>
);
const ChevronIcon = ({ open }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.12s" }}>
    <path d="M9 18l6-6-6-6"/>
  </svg>
);

// Sidebar rule: new conversations are sibling notebooks; branches are child notebooks.
function orderSectionItems(members) {
  if (!members.length) return [];
  const cmpCreated = (a, b) => getConvCreatedAt(a).localeCompare(getConvCreatedAt(b));
  return [...members].sort(cmpCreated).map(cv => ({ conv: cv, depth: 0 }));
}

function sidebarBranchKey(convId, branchName) {
  return convId + ":branch:" + branchName;
}

function buildSidebarLayout(members) {
  const cmpCreated = (a, b) => getConvCreatedAt(a).localeCompare(getConvCreatedAt(b));
  const sorted = [...members].sort(cmpCreated);
  const convMap = new Map(sorted.map(cv => [cv.id, cv]));
  const memo = new Map();
  const rootLoc = { type: "root" };

  const placementFor = (cv, stack = new Set()) => {
    if (memo.has(cv.id)) return memo.get(cv.id);
    if (stack.has(cv.id)) return rootLoc;
    stack.add(cv.id);

    const parent = cv.parentRef?.convId ? convMap.get(cv.parentRef.convId) : null;
    if (!parent) {
      memo.set(cv.id, rootLoc);
      stack.delete(cv.id);
      return rootLoc;
    }

    const parentLoc = placementFor(parent, stack);
    const anchorBranch = commitBranch(parent, cv.parentRef.commitId);
    const loc = anchorBranch && anchorBranch !== "main"
      ? { type: "branch", convId: parent.id, branch: anchorBranch }
      : parentLoc;
    memo.set(cv.id, loc);
    stack.delete(cv.id);
    return loc;
  };

  const rootItems = [];
  const branchChildren = new Map();
  for (const cv of sorted) {
    const loc = placementFor(cv);
    if (loc.type === "branch") {
      const key = sidebarBranchKey(loc.convId, loc.branch);
      if (!branchChildren.has(key)) branchChildren.set(key, []);
      branchChildren.get(key).push(cv);
    } else {
      rootItems.push({ conv: cv, depth: 0 });
    }
  }

  return { rootItems, branchChildren };
}

function pad2(n) { return String(n).padStart(2, "0"); }
function formatClusterTitle(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "Untitled";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function mkClusterId() { return "cluster:" + Date.now() + "_" + Math.random().toString(36).slice(2, 5); }
function getConvCreatedAt(cv) {
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
function normalizeClusters(convs, clusters) {
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
function buildClusterGroups(convs, clusters) {
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

/* ═══════ ICON BUTTON ═══════ */
function IconBtn({ children, title, onClick, disabled, t }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer", padding: 5, borderRadius: 6, color: t.textMuted, display: "flex", alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = t.hoverSidebar; e.currentTarget.style.color = t.text; } }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.textMuted; }}>
      {children}
    </button>
  );
}

/* ═══════ MODEL PICKER ═══════ */
function ModelPicker({ models, value, onChange, thinking, onThinkingChange, t }) {
  const [open, setOpen] = useState(false);
  const current = models.find(m => m.id === value) || models[0];
  const hasThinking = current?.thinking;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ padding: "4px 10px", fontSize: 11, fontWeight: 500, borderRadius: 6, border: "none", background: "transparent", color: t.textSub, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
        onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        {current?.label}
        {hasThinking && thinking && <span style={{ fontSize: 9, color: t.textMuted, marginLeft: 2 }}>Thinking</span>}
        <span style={{ fontSize: 8, color: t.textMuted }}>{"\u25BE"}</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, bottom: "calc(100% + 4px)", zIndex: 60, background: t.bg, border: "0.5px solid " + t.border, borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", padding: "6px", minWidth: 240 }}>
            {models.map(m => {
              const active = m.id === value;
              return (
                <div key={m.id} onClick={() => { onChange(m.id); setOpen(false); }}
                  style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: t.text }}>{m.label}</div>
                    {m.desc && <div style={{ fontSize: 10, color: t.textSub, marginTop: 1 }}>{m.desc}</div>}
                  </div>
                  {active && <span style={{ color: "#378ADD", fontSize: 12 }}>{"\u2713"}</span>}
                </div>
              );
            })}
            {hasThinking && (
              <>
                <div style={{ height: 1, background: t.border, margin: "4px 2px" }} />
                <div onClick={() => onThinkingChange(!thinking)}
                  style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: t.text }}>Thinking</div>
                    <div style={{ fontSize: 10, color: t.textSub, marginTop: 1 }}>Thinks for more complex tasks</div>
                  </div>
                  <div style={{ width: 30, height: 16, borderRadius: 10, background: thinking ? "#378ADD" : t.border, position: "relative", transition: "background 0.15s" }}>
                    <div style={{ position: "absolute", top: 2, left: thinking ? 16 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════ GIT GRAPH ═══════ */
function Graph({ commits, headId, activeBranch, names, onCheckout, onBranch, onNew, onDelete, mergeMode, selected, onToggleSel, selectMode, selectedRangeIds, onSelectNode, onRangeBranch, onRangeNew, onRangeDelete, parentRef, onGoToParent, childRefs, onGoToChild, hoveredCid, panelW, t, branchTitles, onEditLabel, onEditTags, allTags = [] }) {
  const [ctx, setCtx] = useState(null);
  const [editingNodeId, setEditingNodeId] = useState(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [tagPicker, setTagPicker] = useState(null); // { cid, x, y } | null
  const [tagInput, setTagInput] = useState("");
  const [hoverNodeId, setHoverNodeId] = useState(null);
  const hasParent = !!parentRef;
  const sorted = [...commits].sort((a, b) => a.ts - b.ts);

  const vnodes = [];
  if (hasParent) {
    vnodes.push({ vid: "ghost", cid: null, type: "ghost", branch: "main", label: parentRef.promptSummary || "Parent conversation", parentVid: null, mergeVids: [] });
  }
  sorted.forEach(cm => {
    vnodes.push({
      vid: cm.id, cid: cm.id, type: "commit", branch: cm.branch,
      parentVid: cm.parentId || (hasParent ? "ghost" : null),
      mergeVids: cm.mergeIds || [],
    });
    if (childRefs) {
      childRefs.filter(cr => cr.commitId === cm.id).forEach(cr => {
        vnodes.push({ vid: "child_" + cr.convId, cid: null, type: "child", branch: cm.branch, label: cr.convTitle, parentVid: cm.id, mergeVids: [], childConvId: cr.convId });
      });
    }
  });

  if (!vnodes.length) return <div style={{ padding: 20, textAlign: "center", color: t.textMuted, fontSize: 12 }}>Start a conversation</div>;

  /* ── Branch path dimming ── */
  const pathCids = new Set();
  const isMainActive = activeBranch === names[0];
  if (isMainActive) {
    commits.forEach(c => pathCids.add(c.id));
  } else {
    commits.filter(c => c.branch === activeBranch && !(c.mergeIds?.length))
      .forEach(c => pathCids.add(c.id));
    const firstOnBranch = commits.find(c => c.branch === activeBranch &&
      (!c.parentId || commits.find(p => p.id === c.parentId)?.branch !== activeBranch));
    if (firstOnBranch) {
      let pid = firstOnBranch.parentId;
      while (pid) {
        const p = commits.find(c => c.id === pid);
        if (!p) break;
        pathCids.add(p.id);
        pid = p.parentId;
      }
    }
  }
  const vnodeMap = {}; vnodes.forEach(v => { vnodeMap[v.vid] = v; });
  const cidOnPath = cid => isMainActive || pathCids.has(cid);
  const vidOnPath = vid => { const v = vnodeMap[vid]; return !v || v.type === "ghost" || cidOnPath(v.cid); };
  const dimTrans = "opacity 0.2s ease";

  const lW = 22, rH = 24, pL = 18, nR = 6;
  const lX = pL + Math.max(names.length, 1) * lW + 10;
  const W = panelW || 280, H = vnodes.length * rH + 30;
  const maxChars = Math.max(12, Math.floor((W - lX - 20) / 5.5));
  const trunc = (s, n) => s && s.length > n ? s.slice(0, n) + ".." : s;
  const pos = {};
  vnodes.forEach((n, i) => {
    const lane = n.type === "ghost" ? 0 : names.indexOf(n.branch);
    pos[n.vid] = { x: pL + lane * lW, y: 18 + i * rH };
  });

  return (
    <div className="graph-scroll" style={{ overflowY: "auto", overflowX: "hidden", flex: 1, position: "relative" }} onClick={() => setCtx(null)}>
      {/* Branch tabs */}
      <div style={{ padding: "6px 8px", display: "flex", flexWrap: "wrap", gap: 3, borderBottom: "0.5px solid " + t.border, position: "sticky", top: 0, background: t.graphBg, zIndex: 2 }}>
        {names.map(b => {
          const c = bCol(names, b), act = b === activeBranch;
          const raw = getBranchLabel(commits, b, branchTitles);
          const label = raw.length > 14 ? raw.slice(0, 14) + ".." : raw;
          return <button key={b} onClick={() => { const h = bHead(commits, b); if (h) onCheckout(h.id, b); }}
            title={raw}
            style={{ fontSize: 8, padding: "2px 7px", borderRadius: 3, cursor: "pointer", fontWeight: act ? 600 : 400, background: act ? c + "20" : "transparent", color: c, border: act ? "1px solid " + c + "50" : "0.5px solid " + t.border }}>
            {label}{act ? " \u25CF" : ""}
          </button>;
        })}
      </div>

      <svg width={W} height={H} style={{ display: "block" }}>
        {names.map(b => {
          const bv = vnodes.filter(n => n.branch === b && n.type !== "ghost");
          if (!bv.length) return null;
          const p1 = pos[bv[0].vid], p2 = pos[bv[bv.length - 1].vid];
          if (!p1 || !p2) return null;
          const spineOn = isMainActive || bv.some(nd => pathCids.has(nd.cid));
          return <line key={b} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={bCol(names, b)} strokeWidth="2" opacity={spineOn ? 0.25 : 0.12} style={{ transition: dimTrans }} />;
        })}

        {vnodes.map(n => {
          const to = pos[n.vid]; if (!to) return null;
          const parents = [n.parentVid, ...(n.mergeVids || [])].filter(Boolean);
          return parents.map(pid => {
            const fr = pos[pid]; if (!fr) return null;
            const isGhostEdge = pid === "ghost" || n.type === "child";
            const col = isGhostEdge ? t.textMuted : bCol(names, n.branch);
            const isMrg = n.mergeVids?.includes(pid);
            const dash = (isMrg || isGhostEdge) ? "4 3" : "none";
            const baseOp = (isMrg || isGhostEdge) ? 0.3 : 0.35;
            const edgeOn = vidOnPath(n.vid) && vidOnPath(pid);
            const op = edgeOn ? baseOp : 0.12;
            const sw = (isMrg || isGhostEdge) ? 1.5 : 2;
            if (fr.x === to.x) return <line key={pid + "-" + n.vid} x1={fr.x} y1={fr.y + nR + 1} x2={to.x} y2={to.y - nR - 1} stroke={col} strokeWidth={sw} opacity={op} strokeDasharray={dash} style={{ transition: dimTrans }} />;
            const mY = (fr.y + to.y) / 2;
            return <path key={pid + "-" + n.vid} d={`M${fr.x} ${fr.y + nR + 1} C${fr.x} ${mY} ${to.x} ${mY} ${to.x} ${to.y - nR - 1}`} fill="none" stroke={col} strokeWidth={sw} opacity={op} strokeDasharray={dash} style={{ transition: dimTrans }} />;
          });
        })}

        {vnodes.map(n => {
          const p = pos[n.vid]; if (!p) return null;

          if (n.type === "ghost") {
            return (
              <g key={n.vid} style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); onGoToParent(); }}>
                <circle cx={p.x} cy={p.y} r={5} fill="none" stroke={t.textMuted} strokeWidth="1.5" strokeDasharray="3 2" />
                <text x={lX} y={p.y + 3} fontSize="9" fill={t.textMuted} fontStyle="italic" style={{ fontFamily: "system-ui" }}>
                  {trunc(n.label, maxChars)}
                </text>
              </g>
            );
          }

          if (n.type === "child") {
            const parentCid = n.parentVid?.replace(/_[pr]$/, "");
            const nodeOn = isMainActive || (parentCid && pathCids.has(parentCid));
            return (
              <g key={n.vid} style={{ cursor: "pointer", opacity: nodeOn ? 1 : 0.12, transition: dimTrans }} onClick={e => { e.stopPropagation(); onGoToChild(n.childConvId); }}>
                <circle cx={p.x} cy={p.y} r={5} fill="none" stroke={t.textMuted} strokeWidth="1.5" strokeDasharray="3 2" />
                <text x={lX} y={p.y + 3} fontSize="9" fill={t.textMuted} fontStyle="italic" style={{ fontFamily: "system-ui" }}>
                  {"\u2198 " + trunc(n.label, maxChars - 2)}
                </text>
              </g>
            );
          }

          const col = bCol(names, n.branch);
          const cm = commits.find(c => c.id === n.cid);
          const cur = cm?.id === headId;
          const isMrg = (cm?.mergeIds || []).length > 0;
          const mergeSel = selected?.includes(n.cid);
          const rangeSel = selectedRangeIds?.includes(n.cid);
          const sel = mergeSel || rangeSel;
          const hov = hoveredCid === n.cid;
          const r = cur ? 5 : (isMrg ? 5 : nR);
          const isEditing = editingNodeId === n.cid;
          const displayText = cm?.displayLabel || (cm?.prompt || "").replace(/\s+/g, " ").trim();

          const nodeOn = cidOnPath(n.cid);
          return (
            <g key={n.vid} style={{ cursor: "pointer", opacity: nodeOn ? 1 : 0.12, transition: dimTrans }}
              onMouseEnter={() => setHoverNodeId(n.cid)} onMouseLeave={() => setHoverNodeId(p => p === n.cid ? null : p)}
              onClick={e => { if (isEditing) return; e.stopPropagation(); setCtx(null); if (selectMode) { onSelectNode(n.cid); return; } if (mergeMode) { onToggleSel(n.cid); return; } if (cm) onCheckout(cm.id, cm.branch); }}
              onDoubleClick={e => { e.stopPropagation(); if (!cm) return; setLabelDraft(cm.displayLabel || (cm.prompt || "").replace(/\s+/g, " ").trim()); setEditingNodeId(n.cid); }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setCtx({ x: e.clientX, y: e.clientY, cid: n.cid, range: selectMode && rangeSel && selectedRangeIds?.length > 0 }); }}>
              {(cur || sel || hov) && <circle cx={p.x} cy={p.y} r={hov ? 11 : 9} fill={rangeSel ? "#378ADD" : mergeSel ? "#BA7517" : col} opacity={hov ? 0.25 : 0.15} />}
              {isMrg
                ? <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={2} fill={col} stroke={col} strokeWidth="1.5" />
                : <circle cx={p.x} cy={p.y} r={r} fill={t.bg} stroke={rangeSel ? "#378ADD" : mergeSel ? "#BA7517" : col} strokeWidth={cur || rangeSel ? 2.5 : (hov ? 2.5 : 1.5)} />}
              {mergeSel && <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">{"\u2713"}</text>}
              {isEditing ? (
                <foreignObject x={lX - 4} y={p.y - 9} width={Math.max(60, W - lX)} height={18} onClick={e => e.stopPropagation()}>
                  <input autoFocus
                    value={labelDraft}
                    onChange={e => setLabelDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { onEditLabel?.(n.cid, labelDraft); setEditingNodeId(null); }
                      if (e.key === "Escape") setEditingNodeId(null);
                    }}
                    onBlur={() => { onEditLabel?.(n.cid, labelDraft); setEditingNodeId(null); }}
                    onClick={e => e.stopPropagation()}
                    style={{ width: "100%", fontSize: 9, padding: "1px 4px", border: "1px solid #378ADD", borderRadius: 3, outline: "none", boxSizing: "border-box", background: t.bg, color: t.text, fontFamily: "system-ui" }} />
                </foreignObject>
              ) : (
                <text x={lX} y={p.y + 3} fontSize="9" fontWeight={(cur || hov) ? "600" : "400"} fill={(cur || hov) ? col : t.text} style={{ fontFamily: "system-ui" }}>
                  {isMrg ? "\u2B85 " : ""}{trunc(displayText, maxChars)}
                  {cm?.tags?.length > 0 && (
                    <tspan fill="#378ADD" fontSize="8" fontWeight="500">{"  " + cm.tags.map(tg => "#" + tg).join(" ")}</tspan>
                  )}
                </text>
              )}
              {hoverNodeId === n.cid && cm?.model && (
                <text x={lX} y={p.y + 13} fontSize="7" fill={t.textMuted} style={{ fontFamily: "system-ui", pointerEvents: "none" }}>
                  {shortModelName(cm.model)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Context menu */}
      {ctx && !ctx.confirm && (
        <div style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 100, background: t.bg, border: "0.5px solid " + t.border, borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", padding: "4px 0", minWidth: 110 }}
          onClick={e => e.stopPropagation()}>
          <button onClick={() => { const cid = ctx.cid; const isRange = ctx.range; setCtx(null); isRange ? onRangeBranch() : onBranch(cid); }}
            style={{ display: "block", width: "100%", padding: "6px 14px", fontSize: 11, color: t.text, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "none"}>
            branch
          </button>
          <button onClick={() => { const cid = ctx.cid; const isRange = ctx.range; setCtx(null); isRange ? onRangeNew() : onNew(cid); }}
            style={{ display: "block", width: "100%", padding: "6px 14px", fontSize: 11, color: t.text, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "none"}>
            new
          </button>
          {!ctx.range && (
            <button onClick={() => {
              const cid = ctx.cid; const x = ctx.x, y = ctx.y; setCtx(null);
              setTagInput(""); setTagPicker({ cid, x, y });
            }}
              style={{ display: "block", width: "100%", padding: "6px 14px", fontSize: 11, color: t.text, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
              onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "none"}>
              tag
            </button>
          )}
          <div style={{ height: 1, background: t.border, margin: "4px 0" }} />
          <button onClick={() => setCtx({ ...ctx, confirm: true })}
            style={{ display: "block", width: "100%", padding: "6px 14px", fontSize: 11, color: "#c00", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
            onMouseEnter={e => e.currentTarget.style.background = "#fee"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
            delete
          </button>
        </div>
      )}

      {ctx && ctx.confirm && (
        <div style={{ position: "fixed", inset: 0, zIndex: 99, background: "rgba(0,0,0,0.1)" }} onClick={() => setCtx(null)}>
          <div style={{ position: "fixed", left: ctx.x, top: ctx.y, zIndex: 100, background: t.bg, border: "0.5px solid " + t.border, borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,0.15)", padding: "12px 14px", minWidth: 200 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 500, color: t.text, marginBottom: 10 }}>{ctx.range ? "Delete selected commits and their children?" : "Delete this commit and all its children?"}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => { const cid = ctx.cid; const isRange = ctx.range; setCtx(null); isRange ? onRangeDelete() : onDelete(cid); }}
                style={{ flex: 1, padding: "6px", fontSize: 11, fontWeight: 500, borderRadius: 5, background: "#c00", color: "#fff", border: "none", cursor: "pointer" }}>Delete</button>
              <button onClick={() => setCtx(null)}
                style={{ flex: 1, padding: "6px", fontSize: 11, borderRadius: 5, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Tag picker */}
      {tagPicker && (() => {
        const cm = commits.find(c => c.id === tagPicker.cid);
        const current = new Set(cm?.tags || []);
        const pool = Array.from(new Set([...(allTags || []), ...current])).sort();
        const toggle = tg => {
          const next = new Set(current);
          next.has(tg) ? next.delete(tg) : next.add(tg);
          onEditTags?.(tagPicker.cid, [...next].join(","));
        };
        const addNew = () => {
          const tg = tagInput.trim().replace(/^#+/, "");
          if (!tg) return;
          const next = new Set(current); next.add(tg);
          onEditTags?.(tagPicker.cid, [...next].join(","));
          setTagInput("");
        };
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setTagPicker(null)}>
            <div style={{ position: "fixed", left: tagPicker.x, top: tagPicker.y, zIndex: 100, background: t.bg, border: "0.5px solid " + t.border, borderRadius: 8, boxShadow: "0 2px 12px rgba(0,0,0,0.15)", padding: 10, minWidth: 200, maxWidth: 260 }}
              onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 10, fontWeight: 600, color: t.textSub, marginBottom: 6 }}>Tags</div>
              {pool.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                  {pool.map(tg => {
                    const on = current.has(tg);
                    return (
                      <span key={tg} onClick={() => toggle(tg)}
                        style={{ fontSize: 11, fontWeight: 500, color: on ? "#fff" : "#378ADD", background: on ? "#378ADD" : t.hoverSidebar, padding: "3px 9px", borderRadius: 12, cursor: "pointer", userSelect: "none" }}>
                        #{tg}
                      </span>
                    );
                  })}
                </div>
              )}
              <input autoFocus
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { addNew(); }
                  if (e.key === "Escape") setTagPicker(null);
                }}
                placeholder="+ new tag, Enter"
                style={{ width: "100%", boxSizing: "border-box", fontSize: 11, padding: "5px 8px", border: "0.5px solid " + t.border, borderRadius: 6, outline: "none", background: t.bg, color: t.text }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

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
    seedMobyDick();
    const r = storage.list("conv:");
    if (r?.keys?.length) {
      const cs = [];
      for (const k of r.keys) { const p = storage.get(k); if (p?.value) { try { cs.push(JSON.parse(p.value)); } catch {} } }
      const cr = storage.list("cluster:");
      const loadedClusters = [];
      if (cr?.keys?.length) {
        for (const k of cr.keys) { const p = storage.get(k); if (p?.value) { try { loadedClusters.push(JSON.parse(p.value)); } catch {} } }
      }
      const normalized = normalizeClusters(cs, loadedClusters);
      const sorted = normalized.convs.sort((a, b) => (b.u || "").localeCompare(a.u || ""));
      setClusters(normalized.clusters);
      setConvs(sorted);
      // Auto-open Moby Dick on first visit (no conv selected yet)
      const moby = sorted.find(c => c.id === "conv:moby_dick");
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
    storage.set(cluster.id, JSON.stringify(cluster));
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
    storage.set(id, JSON.stringify(cv));
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
    const toDelete = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of convs) {
        if (!toDelete.has(c.id) && c.parentRef && toDelete.has(c.parentRef.convId)) {
          toDelete.add(c.id); grew = true;
        }
      }
    }
    for (const x of toDelete) storage.del(x);
    setConvs(p => p.filter(c => !toDelete.has(c.id)));
    if (toDelete.has(convId)) {
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
      {/* LEFT SIDEBAR */}
      <div style={{ width: 180, display: "flex", flexDirection: "column", borderRight: "0.5px solid " + t.border, background: t.sidebar }}>
        <div style={{ padding: "8px 6px" }}><button onClick={newConv} style={{ width: "100%", padding: "6px", fontSize: 10, fontWeight: 500, borderRadius: 4, background: t.accent, color: t.accentText, border: "none", cursor: "pointer" }}>+ New</button></div>
        {(() => {
          const counts = {};
          convs.forEach(cv => (cv.commits || []).forEach(c => (c.tags || []).forEach(tg => { counts[tg] = (counts[tg] || 0) + 1; })));
          const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          if (!entries.length) return null;
          return (
            <div style={{ padding: "4px 8px 8px", borderBottom: "0.5px solid " + t.border, marginBottom: 4 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: t.textSub, padding: "4px 2px 6px" }}>Tags</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {entries.map(([tg, n]) => {
                  const on = activeTags.has(tg);
                  return (
                    <span key={tg}
                      onClick={() => setActiveTags(p => { const s = new Set(p); s.has(tg) ? s.delete(tg) : s.add(tg); return s; })}
                      style={{ fontSize: 11, fontWeight: 500, color: on ? "#fff" : "#378ADD", background: on ? "#378ADD" : t.hoverSidebar, padding: "3px 9px", borderRadius: 12, cursor: "pointer", userSelect: "none" }}>
                      #{tg} <span style={{ color: on ? "#cfe4ff" : t.textMuted, fontSize: 10 }}>{n}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })()}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 4px" }} onClick={() => setChatMenu(null)}>
          {(() => {
            const renderConvItem = (cv, keyPrefix, depth = 0, toggle = null, branchChildren = new Map()) => {
              const chain = cv.commits || [];
              const branchTree = buildBranchTree(chain);
              const convActive = convId === cv.id;
              const convActiveOnMain = convActive && branch === "main";
              const renamingThisConv = renamingId === cv.id;
              const branchesByParent = {};
              branchTree.forEach(b => {
                const parent = b.parentBranch || "main";
                (branchesByParent[parent] || (branchesByParent[parent] = [])).push(b);
              });
              const rootBranches = branchesByParent["main"] || [];
              const ownToggleKey = cv.id + ":conv";
              const localToggle = !toggle && rootBranches.length > 0
                ? { open: sidebarItemOpen(ownToggleKey, true), onToggle: () => toggleSidebarItem(ownToggleKey, true) }
                : null;
              const activeToggle = toggle || localToggle;
              const hasToggle = !!activeToggle;
              const showBranches = !hasToggle || activeToggle.open;
              const branchKey = bName => sidebarBranchKey(cv.id, bName);
              const branchOpen = bName => sidebarItemOpen(branchKey(bName));
              const containsActiveConv = (items, seen = new Set()) => items.some(child => {
                if (child.id === convId) return true;
                if (seen.has(child.id)) return false;
                seen.add(child.id);
                return buildBranchTree(child.commits || []).some(b => {
                  const kids = branchChildren.get(sidebarBranchKey(child.id, b.branch)) || [];
                  return containsActiveConv(kids, seen);
                });
              });
              const newSiblingsContainActive = bName => containsActiveConv(branchChildren.get(branchKey(bName)) || []);
              const branchSubtreeContainsActive = bName => (branchesByParent[bName] || []).some(child =>
                newSiblingsContainActive(child.branch) || branchSubtreeContainsActive(child.branch)
              );
              const renderBranchNode = ({ branch: bName, depth: bDepth }) => {
                const branchActive = convActive && branch === bName;
                const renamingThisBranch = renamingBranch && renamingBranch.convId === cv.id && renamingBranch.branch === bName;
                const displayLabel = getBranchLabel(chain, bName, cv.branchTitles);
                const childBranches = branchesByParent[bName] || [];
                const siblingConvs = branchChildren.get(branchKey(bName)) || [];
                const hasBranchChildren = childBranches.length > 0;
                const isBranchOpen = branchOpen(bName) || branchSubtreeContainsActive(bName);
                return (
                  <div key={keyPrefix + ":" + cv.id + ":" + bName}>
                    <div className="chat-item"
                      onClick={() => { if (!renamingThisBranch) { if (hasBranchChildren && !isBranchOpen) toggleSidebarItem(branchKey(bName)); loadBranch(cv, bName); } }}
                      style={{ padding: "5px 6px", paddingLeft: 6 + (depth + bDepth) * 12, marginBottom: 1, borderRadius: 4, cursor: "pointer", fontSize: 10, background: branchActive ? t.hover : (hasBranchChildren && isBranchOpen ? t.hoverSidebar : "transparent"), border: branchActive ? "0.5px solid " + t.border : "0.5px solid transparent", display: "flex", alignItems: "center", position: "relative" }}
                      onMouseEnter={e => { e.currentTarget.style.background = t.hover; e.currentTarget.querySelector(".dots") && (e.currentTarget.querySelector(".dots").style.opacity = "1"); }}
                      onMouseLeave={e => { if (!branchActive) e.currentTarget.style.background = hasBranchChildren && isBranchOpen ? t.hoverSidebar : "transparent"; e.currentTarget.querySelector(".dots") && (e.currentTarget.querySelector(".dots").style.opacity = "0"); }}>
                      {hasBranchChildren ? (
                        <button onClick={e => { e.stopPropagation(); toggleSidebarItem(branchKey(bName)); }}
                          title={isBranchOpen ? "Collapse" : "Expand"}
                          style={{ width: 18, height: 18, marginRight: 4, padding: 0, border: "none", background: "transparent", color: t.textSub, cursor: "pointer", fontSize: 13, fontWeight: 700, lineHeight: "18px" }}>
                          {isBranchOpen ? "v" : ">"}
                        </button>
                      ) : <span style={{ width: 22, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {renamingThisBranch ? (
                          <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") { renameBranch(cv.id, bName, renameVal); setRenamingBranch(null); } if (e.key === "Escape") setRenamingBranch(null); }}
                            onBlur={() => { renameBranch(cv.id, bName, renameVal); setRenamingBranch(null); }}
                            onClick={e => e.stopPropagation()}
                            style={{ width: "100%", fontSize: 10, fontWeight: 500, padding: "1px 3px", border: "1px solid #378ADD", borderRadius: 3, outline: "none", boxSizing: "border-box", background: t.bg, color: t.text }} />
                        ) : (
                          <div style={{ fontSize: 10, fontWeight: hasBranchChildren && isBranchOpen ? 650 : 500, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayLabel}>
                            {displayLabel}
                          </div>
                        )}
                      </div>
                      {!renamingThisBranch && <span className="dots"
                        onClick={e => { e.stopPropagation(); setChatMenu(chatMenu?.kind === "branch" && chatMenu.convId === cv.id && chatMenu.branch === bName ? null : { kind: "branch", convId: cv.id, branch: bName, x: e.clientX, y: e.clientY }); }}
                        style={{ opacity: 0, fontSize: 14, color: t.textMuted, padding: "0 4px", cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0, lineHeight: 1 }}>{"\u22EF"}</span>}
                    </div>
                    {hasBranchChildren && isBranchOpen && childBranches.map(renderBranchNode)}
                    {siblingConvs.map(childCv => renderConvItem(
                      childCv,
                      keyPrefix + ":" + cv.id + ":" + bName,
                      depth + bDepth,
                      null,
                      branchChildren
                    ))}
                  </div>
                );
              };
              const itemBg = convActiveOnMain ? t.hover : (hasToggle && activeToggle.open ? t.hoverSidebar : "transparent");
              const itemBorder = convActiveOnMain ? "0.5px solid " + t.border : "0.5px solid transparent";
              return (
                <div key={keyPrefix + ":" + cv.id}>
                  <div className="chat-item"
                    onClick={() => { if (!renamingThisConv) { if (hasToggle && !activeToggle.open) activeToggle.onToggle(); loadMain(cv); } }}
                    style={{ padding: "6px 6px", paddingLeft: 6 + depth * 12, marginBottom: 1, borderRadius: 4, cursor: "pointer", fontSize: 10, background: itemBg, border: itemBorder, display: "flex", alignItems: "center", position: "relative" }}
                    onMouseEnter={e => { e.currentTarget.style.background = t.hover; e.currentTarget.querySelector(".dots") && (e.currentTarget.querySelector(".dots").style.opacity = "1"); }}
                    onMouseLeave={e => { if (!convActiveOnMain) e.currentTarget.style.background = itemBg; e.currentTarget.querySelector(".dots") && (e.currentTarget.querySelector(".dots").style.opacity = "0"); }}>
                    {hasToggle ? (
                      <button onClick={e => { e.stopPropagation(); activeToggle.onToggle(); }}
                        title={activeToggle.open ? "Collapse" : "Expand"}
                        style={{ width: 18, height: 18, marginRight: 4, padding: 0, border: "none", background: "transparent", color: t.textSub, cursor: "pointer", fontSize: 13, fontWeight: 700, lineHeight: "18px" }}>
                        {activeToggle.open ? "v" : ">"}
                      </button>
                    ) : <span style={{ width: 22, flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renamingThisConv ? (
                        <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") { renameConv(cv.id, renameVal); setRenamingId(null); } if (e.key === "Escape") setRenamingId(null); }}
                          onBlur={() => { renameConv(cv.id, renameVal); setRenamingId(null); }}
                          onClick={e => e.stopPropagation()}
                          style={{ width: "100%", fontSize: 10, fontWeight: 500, padding: "1px 3px", border: "1px solid #378ADD", borderRadius: 3, outline: "none", boxSizing: "border-box", background: t.bg, color: t.text }} />
                      ) : (
                        <div style={{ fontSize: 10, fontWeight: hasToggle && activeToggle.open ? 650 : 500, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={cv.title || "Untitled"}>
                          {cv.title || "Untitled"}
                        </div>
                      )}
                    </div>
                    {!renamingThisConv && <span className="dots"
                      onClick={e => { e.stopPropagation(); setChatMenu(chatMenu?.kind === "conv" && chatMenu.id === cv.id ? null : { kind: "conv", id: cv.id, x: e.clientX, y: e.clientY }); }}
                      style={{ opacity: 0, fontSize: 14, color: t.textMuted, padding: "0 4px", cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0, lineHeight: 1 }}>{"\u22EF"}</span>}
                  </div>
                  {showBranches && rootBranches.map(renderBranchNode)}
                </div>
              );
            };
            const liveTags = new Set();
            convs.forEach(cv => (cv.commits || []).forEach(c => (c.tags || []).forEach(tg => liveTags.add(tg))));
            const liveActive = new Set([...activeTags].filter(tg => liveTags.has(tg)));
            const convHasAnyTag = cv => (cv.commits || []).some(c => (c.tags || []).some(tg => liveActive.has(tg)));
            const filteredGroups = liveActive.size
              ? clusterGroups.map(g => ({ ...g, items: g.items.filter(convHasAnyTag) })).filter(g => g.items.length)
              : clusterGroups;
            return filteredGroups.map(group => {
              const { rootItems: ordered, branchChildren } = buildSidebarLayout(group.items);
              const groupOpen = collapsedClusters.has(group.cluster.id);
              const visible = groupOpen ? ordered : ordered.slice(0, 1);
              return (
                <div key={group.cluster.id} style={{ marginBottom: 6 }}>
                  {visible.map((item, idx) => {
                    const isGroupRoot = item.conv.id === ordered[0]?.conv.id;
                    const hasRootChildren = ordered.length > 1 || buildBranchTree(item.conv.commits || []).length > 0;
                    const toggle = isGroupRoot && hasRootChildren
                      ? { open: groupOpen, onToggle: () => toggleCluster(group.cluster.id) }
                      : null;
                    return renderConvItem(
                      item.conv,
                      "cl:" + group.cluster.id,
                      groupOpen ? item.depth : 0,
                      toggle,
                      branchChildren
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>

        {/* Chat context menu (kind: "conv" | "branch") */}
        {chatMenu && (
          <div style={{ position: "fixed", inset: 0, zIndex: 98 }} onClick={() => setChatMenu(null)}>
            <div style={{ position: "fixed", left: chatMenu.x, top: chatMenu.y, zIndex: 100, background: t.bg, border: "0.5px solid " + t.border, borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", padding: "4px 0", minWidth: 100 }}
              onClick={e => e.stopPropagation()}>
              <button onClick={() => {
                  if (chatMenu.kind === "conv") {
                    const cv = convs.find(c => c.id === chatMenu.id);
                    setRenameVal(cv?.title || ""); setRenamingId(chatMenu.id); setRenamingBranch(null); setRenamingClusterId(null);
                  } else if (chatMenu.kind === "branch") {
                    const cv = convs.find(c => c.id === chatMenu.convId);
                    setRenameVal(getBranchLabel(cv?.commits || [], chatMenu.branch, cv?.branchTitles));
                    setRenamingBranch({ convId: chatMenu.convId, branch: chatMenu.branch }); setRenamingId(null); setRenamingClusterId(null);
                  }
                  setChatMenu(null);
                }}
                style={{ display: "block", width: "100%", padding: "6px 14px", fontSize: 11, color: t.text, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                rename
              </button>
              <div style={{ height: 1, background: t.border, margin: "2px 0" }} />
              <button onClick={() => {
                  if (chatMenu.kind === "conv") {
                    const n = countChildConvs(chatMenu.id);
                    const msg = n > 0 ? `Delete this conversation and ${n} descendant conversation${n > 1 ? "s" : ""}?` : "Delete this conversation?";
                    const id = chatMenu.id;
                    setConfirmDialog({ msg, onConfirm: () => del(id) });
                  } else if (chatMenu.kind === "branch") {
                    const cv = convs.find(c => c.id === chatMenu.convId);
                    if (cv) {
                      const descs = getBranchDescendantNames(cv.commits || [], chatMenu.branch);
                      const msg = descs.length > 0
                        ? `Delete branch "${chatMenu.branch}"? This will also delete ${descs.length} child branch${descs.length > 1 ? "es" : ""}.`
                        : `Delete branch "${chatMenu.branch}"?`;
                      const cid = chatMenu.convId, b = chatMenu.branch;
                      setConfirmDialog({ msg, onConfirm: () => deleteBranchCascade(cid, b) });
                    }
                  }
                  setChatMenu(null);
                }}
                style={{ display: "block", width: "100%", padding: "6px 14px", fontSize: 11, color: "#c00", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                onMouseEnter={e => e.currentTarget.style.background = "#fee"} onMouseLeave={e => e.currentTarget.style.background = "none"}>
                delete
              </button>
            </div>
          </div>
        )}

        {/* API Key */}
        <div style={{ borderTop: "0.5px solid " + t.border, padding: "6px 6px 0" }}>
          {!showKeyInput ? (
            <button onClick={() => { setKeyDraft(apiKey); setShowKeyInput(true); }}
              style={{ width: "100%", padding: "5px 8px", fontSize: 9, borderRadius: 4, border: "none", background: "transparent", cursor: "pointer",
                color: hasKey ? "#1D9E75" : t.textSub, textAlign: "left", display: "flex", alignItems: "center", gap: 4 }}
              onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              {hasKey ? "\u{1F511} Connected" : "\u{1F511} API Key"}
              {hasKey && detectProvider(apiKey) && <span style={{ fontSize: 8, color: detectProvider(apiKey).color, fontWeight: 500 }}>{detectProvider(apiKey).name}</span>}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "2px 0 4px" }}>
              <input autoFocus type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
                placeholder="sk-ant-... or sk-..."
                onKeyDown={e => { if (e.key === "Enter") { setApiKey(keyDraft.trim()); storage.set("apiKey", keyDraft.trim()); setShowKeyInput(false); setRateLimited(false); } if (e.key === "Escape") setShowKeyInput(false); }}
                style={{ width: "100%", boxSizing: "border-box", padding: "5px 6px", fontSize: 9, borderRadius: 4, border: "0.5px solid " + t.border, background: t.bg, color: t.text, fontFamily: "monospace" }} />
              <div style={{ display: "flex", gap: 3 }}>
                <button onClick={() => { setApiKey(keyDraft.trim()); storage.set("apiKey", keyDraft.trim()); setShowKeyInput(false); setRateLimited(false); }}
                  style={{ flex: 1, padding: "3px", fontSize: 8, fontWeight: 600, borderRadius: 3, background: t.accent, color: t.accentText, border: "none", cursor: "pointer" }}>Save</button>
                <button onClick={() => setShowKeyInput(false)}
                  style={{ flex: 1, padding: "3px", fontSize: 8, borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
              </div>
              {keyDraft.trim() && detectProvider(keyDraft) && <div style={{ fontSize: 8, color: detectProvider(keyDraft).color, fontWeight: 500 }}>{"\u2713"} {detectProvider(keyDraft).name}</div>}
              {keyDraft.trim() && !detectProvider(keyDraft) && <div style={{ fontSize: 8, color: "#c00" }}>{"\u2717"} Unknown format</div>}
            </div>
          )}
        </div>

        {/* Bottom bar: dark mode toggle + GitHub */}
        <div style={{ borderTop: "0.5px solid " + t.border, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setDark(d => !d)} title={dark ? "Light mode" : "Dark mode"}
            style={{ background: "none", border: "none", cursor: "pointer", color: t.textSub, padding: 4, borderRadius: 4, display: "flex", alignItems: "center" }}
            onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textSub}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <a href="https://github.com/eldensari/openbranch" target="_blank" rel="noopener noreferrer" title="GitHub"
            style={{ color: t.textSub, display: "flex", alignItems: "center", padding: 4, borderRadius: 4 }}
            onMouseEnter={e => e.currentTarget.style.color = t.text} onMouseLeave={e => e.currentTarget.style.color = t.textSub}>
            <GitHubIcon />
          </a>
        </div>
      </div>

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

      {/* Confirm dialog */}
      {confirmDialog && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setConfirmDialog(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: t.bg, border: "0.5px solid " + t.border, borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "18px 20px", minWidth: 280, maxWidth: 380 }}>
            <div style={{ fontSize: 13, color: t.text, marginBottom: 16, lineHeight: 1.45 }}>{confirmDialog.msg}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmDialog(null)}
                style={{ padding: "7px 14px", fontSize: 11, borderRadius: 6, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
              <button onClick={() => { confirmDialog.onConfirm?.(); setConfirmDialog(null); }}
                style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, borderRadius: 6, background: "#c00", color: "#fff", border: "none", cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
