import { useState } from "react";
import { bCol } from "../theme";
import { bHead, shortModelName } from "../graph/model";
import { getBranchLabel } from "../graph/branches";

export default function Graph({ commits, headId, activeBranch, names, onCheckout, onBranch, onNew, onDelete, mergeMode, selected, onToggleSel, selectMode, selectedRangeIds, onSelectNode, onRangeBranch, onRangeNew, onRangeDelete, parentRef, onGoToParent, childRefs, onGoToChild, hoveredCid, panelW, t, branchTitles, onEditLabel, onEditTags, allTags = [] }) {
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
            {label}{act ? " ●" : ""}
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
                  {"↘ " + trunc(n.label, maxChars - 2)}
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
              {mergeSel && <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="7" fontWeight="700" fill="#fff">{"✓"}</text>}
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
                  {isMrg ? "⮅ " : ""}{trunc(displayText, maxChars)}
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
