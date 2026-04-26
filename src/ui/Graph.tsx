import { useState } from "react";
import { bCol } from "@/lib/branch-colors";
import { bHead, shortModelName } from "@/graph/model";
import { getBranchLabel } from "@/graph/branches";
import { cn } from "@/lib/utils";
import RenameDialog from "./RenameDialog";

function orderBranchesByTree(commits: any[], names: string[]): string[] {
  const sorted = [...commits].sort((a: any, b: any) => a.ts - b.ts);
  const nameSet = new Set(names);
  const parentOf = new Map<string, string | null>();
  for (const b of names) {
    const first = sorted.find((c: any) => c.branch === b);
    if (!first || !first.parentId) { parentOf.set(b, null); continue; }
    const parent = commits.find((c: any) => c.id === first.parentId);
    parentOf.set(b, parent && parent.branch !== b && nameSet.has(parent.branch) ? parent.branch : null);
  }
  const childrenOf = new Map<string | null, string[]>();
  for (const b of names) {
    const p = parentOf.get(b) ?? null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(b);
  }
  const result: string[] = [];
  const visited = new Set<string>();
  const visit = (b: string) => {
    if (visited.has(b)) return;
    visited.add(b);
    result.push(b);
    for (const c of childrenOf.get(b) || []) visit(c);
  };
  for (const root of childrenOf.get(null) || []) visit(root);
  for (const b of names) if (!visited.has(b)) visit(b);
  return result;
}

type Props = {
  commits: any[];
  headId: string | null;
  activeBranch: string;
  names: string[];
  onCheckout: (id: string, b: string) => void;
  onBranch: (cid: string) => void;
  onNew: (cid: string) => void;
  onDelete: (cid: string) => void;
  mergeMode: boolean;
  selected: string[];
  onToggleSel: (id: string) => void;
  selectMode: boolean;
  selectedRangeIds: string[];
  onSelectNode: (cid: string) => void;
  onRangeBranch: () => void;
  onRangeNew: () => void;
  onRangeDelete: () => void;
  parentRef: any;
  onGoToParent: () => void;
  childRefs?: any[];
  onGoToChild: (id: string) => void;
  hoveredCid: string | null;
  panelW: number;
  branchTitles: Record<string, string>;
  onEditLabel?: (cid: string, label: string) => void;
  onEditTags?: (cid: string, tags: string) => void;
  allTags?: string[];
  activeTags?: Set<string>;
  onRenameBranch?: (bName: string, newTitle: string) => void;
  onDeleteBranch?: (bName: string) => void;
};

export default function Graph(props: Props) {
  const {
    commits, headId, activeBranch, names, onCheckout, onBranch, onNew, onDelete,
    mergeMode, selected, onToggleSel, selectMode, selectedRangeIds, onSelectNode,
    onRangeBranch, onRangeNew, onRangeDelete, parentRef, onGoToParent, childRefs,
    onGoToChild, hoveredCid, panelW, branchTitles, onEditLabel, onEditTags,
    allTags = [], activeTags,
    onRenameBranch, onDeleteBranch,
  } = props;
  const [ctx, setCtx] = useState<any>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [tagPicker, setTagPicker] = useState<any>(null);
  const [tagInput, setTagInput] = useState("");
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [chipCtx, setChipCtx] = useState<{ x: number; y: number; branch: string } | null>(null);
  const [renamingBranchName, setRenamingBranchName] = useState<string | null>(null);
  const hasParent = !!parentRef;
  const sorted = [...commits].sort((a: any, b: any) => a.ts - b.ts);

  const vnodes: any[] = [];
  if (hasParent) {
    vnodes.push({ vid: "ghost", cid: null, type: "ghost", branch: "main", label: parentRef.promptSummary || "Parent conversation", parentVid: null, mergeVids: [] });
  }
  sorted.forEach((cm: any) => {
    vnodes.push({
      vid: cm.id, cid: cm.id, type: "commit", branch: cm.branch,
      parentVid: cm.parentId || (hasParent ? "ghost" : null),
      mergeVids: cm.mergeIds || [],
    });
    if (childRefs) {
      childRefs.filter((cr: any) => cr.commitId === cm.id).forEach((cr: any) => {
        vnodes.push({ vid: "child_" + cr.convId, cid: null, type: "child", branch: cm.branch, label: cr.convTitle, parentVid: cm.id, mergeVids: [], childConvId: cr.convId });
      });
    }
  });

  if (!vnodes.length)
    return <div className="p-6 text-center text-sm text-muted-foreground">Start a conversation</div>;

  const pathCids = new Set<string>();
  const isMainActive = activeBranch === names[0];
  if (isMainActive) {
    commits.forEach((c: any) => pathCids.add(c.id));
  } else {
    commits
      .filter((c: any) => c.branch === activeBranch && !(c.mergeIds?.length))
      .forEach((c: any) => pathCids.add(c.id));
    const firstOnBranch = commits.find(
      (c: any) => c.branch === activeBranch && (!c.parentId || commits.find((p: any) => p.id === c.parentId)?.branch !== activeBranch),
    );
    if (firstOnBranch) {
      let pid = firstOnBranch.parentId;
      while (pid) {
        const p = commits.find((c: any) => c.id === pid);
        if (!p) break;
        pathCids.add(p.id);
        pid = p.parentId;
      }
    }
  }
  const vnodeMap: Record<string, any> = {};
  vnodes.forEach((v) => (vnodeMap[v.vid] = v));
  const cidOnPath = (cid: string) => isMainActive || pathCids.has(cid);
  const vidOnPath = (vid: string) => {
    const v = vnodeMap[vid];
    return !v || v.type === "ghost" || cidOnPath(v.cid);
  };

  const lW = 22, rH = 26, pL = 18, nR = 6;
  const lX = pL + Math.max(names.length, 1) * lW + 12;
  const W = panelW || 280;
  const H = vnodes.length * rH + 30;
  const maxChars = Math.max(12, Math.floor((W - lX - 20) / 6));
  const trunc = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) + ".." : s);
  const pos: Record<string, { x: number; y: number }> = {};
  vnodes.forEach((n, i) => {
    const lane = n.type === "ghost" ? 0 : names.indexOf(n.branch);
    pos[n.vid] = { x: pL + lane * lW, y: 18 + i * rH };
  });

  const mutedFg = "var(--muted-foreground)";
  const fg = "var(--foreground)";
  const bg = "var(--background)";

  return (
    <div className="graph-scroll relative flex-1 overflow-y-auto overflow-x-hidden" onClick={() => { setCtx(null); setChipCtx(null); }}>
      <div className="graph-scroll sticky top-0 z-10 flex gap-1 overflow-x-auto border-b bg-graph-bg px-3 py-2">
        {orderBranchesByTree(commits, names).map((b) => {
          const c = bCol(names, b);
          const act = b === activeBranch;
          const raw = getBranchLabel(commits, b, branchTitles);
          const label = raw.length > 16 ? raw.slice(0, 16) + ".." : raw;
          return (
            <button
              key={b}
              onClick={() => {
                const h = bHead(commits, b);
                if (h) onCheckout(h.id, b);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setChipCtx({ x: e.clientX, y: e.clientY, branch: b });
              }}
              title={raw}
              className={cn(
                "shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                act ? "font-semibold" : "font-normal opacity-80 hover:opacity-100",
              )}
              style={{
                color: c,
                borderColor: act ? c : "var(--border)",
                background: act ? `color-mix(in oklch, ${c} 12%, transparent)` : "transparent",
              }}
            >
              {label}
              {act ? " ●" : ""}
            </button>
          );
        })}
      </div>

      <svg width={W} height={H} style={{ display: "block" }}>
        {names.map((b) => {
          const bv = vnodes.filter((n) => n.branch === b && n.type !== "ghost");
          if (!bv.length) return null;
          const p1 = pos[bv[0].vid];
          const p2 = pos[bv[bv.length - 1].vid];
          if (!p1 || !p2) return null;
          const spineOn = isMainActive || bv.some((nd) => pathCids.has(nd.cid));
          return <line key={b} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={bCol(names, b)} strokeWidth={2} opacity={spineOn ? 0.3 : 0.12} style={{ transition: "opacity 0.2s" }} />;
        })}

        {vnodes.map((n) => {
          const to = pos[n.vid];
          if (!to) return null;
          const parents = [n.parentVid, ...(n.mergeVids || [])].filter(Boolean);
          return parents.map((pid: string) => {
            const fr = pos[pid];
            if (!fr) return null;
            const isGhostEdge = pid === "ghost" || n.type === "child";
            const col = isGhostEdge ? mutedFg : bCol(names, n.branch);
            const isMrg = n.mergeVids?.includes(pid);
            const dash = isMrg || isGhostEdge ? "4 3" : "none";
            const baseOp = isMrg || isGhostEdge ? 0.32 : 0.38;
            const edgeOn = vidOnPath(n.vid) && vidOnPath(pid);
            const op = edgeOn ? baseOp : 0.12;
            const sw = isMrg || isGhostEdge ? 1.5 : 2;
            if (fr.x === to.x)
              return <line key={pid + "-" + n.vid} x1={fr.x} y1={fr.y + nR + 1} x2={to.x} y2={to.y - nR - 1} stroke={col} strokeWidth={sw} opacity={op} strokeDasharray={dash} style={{ transition: "opacity 0.2s" }} />;
            const mY = (fr.y + to.y) / 2;
            return <path key={pid + "-" + n.vid} d={`M${fr.x} ${fr.y + nR + 1} C${fr.x} ${mY} ${to.x} ${mY} ${to.x} ${to.y - nR - 1}`} fill="none" stroke={col} strokeWidth={sw} opacity={op} strokeDasharray={dash} style={{ transition: "opacity 0.2s" }} />;
          });
        })}

        {vnodes.map((n) => {
          const p = pos[n.vid];
          if (!p) return null;

          if (n.type === "ghost") {
            return (
              <g key={n.vid} style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onGoToParent(); }}>
                <circle cx={p.x} cy={p.y} r={5} fill="none" stroke={mutedFg} strokeWidth={1.5} strokeDasharray="3 2" />
                <text x={lX} y={p.y + 4} fontSize={11} fill={mutedFg} fontStyle="italic" style={{ fontFamily: "system-ui" }}>
                  {trunc(n.label, maxChars)}
                </text>
              </g>
            );
          }

          if (n.type === "child") {
            const parentCid = n.parentVid?.replace(/_[pr]$/, "");
            const nodeOn = isMainActive || (parentCid && pathCids.has(parentCid));
            return (
              <g key={n.vid} style={{ cursor: "pointer", opacity: nodeOn ? 1 : 0.12, transition: "opacity 0.2s" }} onClick={(e) => { e.stopPropagation(); onGoToChild(n.childConvId); }}>
                <circle cx={p.x} cy={p.y} r={5} fill="none" stroke={mutedFg} strokeWidth={1.5} strokeDasharray="3 2" />
                <text x={lX} y={p.y + 4} fontSize={11} fill={mutedFg} fontStyle="italic" style={{ fontFamily: "system-ui" }}>
                  {"↘ " + trunc(n.label, maxChars - 2)}
                </text>
              </g>
            );
          }

          const col = bCol(names, n.branch);
          const cm = commits.find((c: any) => c.id === n.cid);
          const cur = cm?.id === headId;
          const isMrg = (cm?.mergeIds || []).length > 0;
          const mergeSel = selected?.includes(n.cid);
          const rangeSel = selectedRangeIds?.includes(n.cid);
          const sel = mergeSel || rangeSel;
          const hov = hoveredCid === n.cid;
          const hasActiveTag = activeTags && activeTags.size > 0 && (cm?.tags || []).some((tg: string) => activeTags.has(tg));
          const r = cur ? 6 : isMrg ? 6 : nR;
          const isEditing = editingNodeId === n.cid;
          const displayText = cm?.displayLabel || (cm?.prompt || "").replace(/\s+/g, " ").trim();

          const nodeOn = cidOnPath(n.cid);
          const hasFilter = activeTags && activeTags.size > 0;
          const dimByTag = hasFilter && !hasActiveTag;
          const nodeOpacity = nodeOn && !dimByTag ? 1 : 0.14;
          return (
            <g
              key={n.vid}
              style={{ cursor: "pointer", opacity: nodeOpacity, transition: "opacity 0.2s" }}
              onMouseEnter={() => setHoverNodeId(n.cid)}
              onMouseLeave={() => setHoverNodeId((p) => (p === n.cid ? null : p))}
              onClick={(e) => {
                if (isEditing) return;
                e.stopPropagation();
                setCtx(null);
                if (selectMode) { onSelectNode(n.cid); return; }
                if (mergeMode) { onToggleSel(n.cid); return; }
                if (cm) onCheckout(cm.id, cm.branch);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!cm) return;
                setLabelDraft(cm.displayLabel || (cm.prompt || "").replace(/\s+/g, " ").trim());
                setEditingNodeId(n.cid);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCtx({ x: e.clientX, y: e.clientY, cid: n.cid, range: selectMode && rangeSel && selectedRangeIds?.length > 0 });
              }}
            >
              {(cur || sel || hov) && <circle cx={p.x} cy={p.y} r={hov ? 12 : 10} fill={rangeSel ? "var(--branch-1)" : mergeSel ? "var(--branch-5)" : col} opacity={hov ? 0.22 : 0.15} />}
              {isMrg ? (
                <rect x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={2} fill={col} stroke={col} strokeWidth={1.5} />
              ) : (
                <circle cx={p.x} cy={p.y} r={r} fill={bg} stroke={rangeSel ? "var(--branch-1)" : mergeSel ? "var(--branch-5)" : col} strokeWidth={cur || rangeSel ? 2.6 : hov ? 2.4 : 1.7} />
              )}
              {mergeSel && (
                <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">✓</text>
              )}
              {isEditing ? (
                <foreignObject x={lX - 4} y={p.y - 10} width={Math.max(60, W - lX)} height={22} onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={labelDraft}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { onEditLabel?.(n.cid, labelDraft); setEditingNodeId(null); }
                      if (e.key === "Escape") setEditingNodeId(null);
                    }}
                    onBlur={() => { onEditLabel?.(n.cid, labelDraft); setEditingNodeId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="box-border w-full rounded-sm border bg-background px-1.5 py-0.5 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-ring"
                    style={{ borderColor: "var(--ring)" }}
                  />
                </foreignObject>
              ) : (
                <text x={lX} y={p.y + 4} fontSize={11.5} fontWeight={cur || hov ? 600 : 400} fill={cur || hov ? col : fg} style={{ fontFamily: "system-ui" }}>
                  {isMrg ? "⮅ " : ""}
                  {trunc(displayText, maxChars)}
                  {cm?.tags?.length > 0 && (
                    <tspan fill="var(--branch-1)" fontSize={10} fontWeight={500}>
                      {"  " + cm.tags.map((tg: string) => "#" + tg).join(" ")}
                    </tspan>
                  )}
                </text>
              )}
              {hoverNodeId === n.cid && cm?.model && (
                <text x={lX} y={p.y + 17} fontSize={9} fill={mutedFg} style={{ fontFamily: "system-ui", pointerEvents: "none" }}>
                  {shortModelName(cm.model)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {chipCtx && (
        <div
          className="fixed z-[100] min-w-[140px] overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
          style={{ left: chipCtx.x, top: chipCtx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setRenamingBranchName(chipCtx.branch);
              setChipCtx(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            Rename
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={() => { const b = chipCtx.branch; setChipCtx(null); onDeleteBranch?.(b); }}
            className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            Delete
          </button>
        </div>
      )}

      {ctx && !ctx.confirm && (
        <div
          className="fixed z-[100] min-w-[140px] overflow-hidden rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
          style={{ left: ctx.x, top: ctx.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { const cid = ctx.cid; const isRange = ctx.range; setCtx(null); isRange ? onRangeBranch() : onBranch(cid); }}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            Branch
          </button>
          <button
            onClick={() => { const cid = ctx.cid; const isRange = ctx.range; setCtx(null); isRange ? onRangeNew() : onNew(cid); }}
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            New
          </button>
          {!ctx.range && (
            <button
              onClick={() => { const cid = ctx.cid; const x = ctx.x; const y = ctx.y; setCtx(null); setTagInput(""); setTagPicker({ cid, x, y }); }}
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              Tag
            </button>
          )}
          <div className="my-1 h-px bg-border" />
          <button
            onClick={() => setCtx({ ...ctx, confirm: true })}
            className="block w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            Delete
          </button>
        </div>
      )}

      {ctx && ctx.confirm && (
        <div className="fixed inset-0 z-[99] bg-black/10" onClick={() => setCtx(null)}>
          <div
            className="fixed z-[100] min-w-[240px] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
            style={{ left: ctx.x, top: ctx.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-sm font-medium">
              {ctx.range ? "Delete selected commits and their children?" : "Delete this commit and all its children?"}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { const cid = ctx.cid; const isRange = ctx.range; setCtx(null); isRange ? onRangeDelete() : onDelete(cid); }}
                className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </button>
              <button onClick={() => setCtx(null)} className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-accent">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {tagPicker && (() => {
        const cm = commits.find((c: any) => c.id === tagPicker.cid);
        const current = new Set<string>(cm?.tags || []);
        const pool = Array.from(new Set([...(allTags || []), ...current])).sort();
        const toggle = (tg: string) => {
          const next = new Set(current);
          next.has(tg) ? next.delete(tg) : next.add(tg);
          onEditTags?.(tagPicker.cid, [...next].join(","));
        };
        const addNew = () => {
          const tg = tagInput.trim().replace(/^#+/, "");
          if (!tg) return;
          const next = new Set(current);
          next.add(tg);
          onEditTags?.(tagPicker.cid, [...next].join(","));
          setTagInput("");
        };
        return (
          <div className="fixed inset-0 z-[99]" onClick={() => setTagPicker(null)}>
            <div
              className="fixed z-[100] min-w-[220px] max-w-[300px] rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
              style={{ left: tagPicker.x, top: tagPicker.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Tags</div>
              {pool.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {pool.map((tg) => {
                    const on = current.has(tg);
                    return (
                      <span
                        key={tg}
                        onClick={() => toggle(tg)}
                        className={cn(
                          "cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium select-none",
                          on ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-accent",
                        )}
                      >
                        #{tg}
                      </span>
                    );
                  })}
                </div>
              )}
              <input
                autoFocus
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addNew();
                  if (e.key === "Escape") setTagPicker(null);
                }}
                placeholder="+ new tag, Enter"
                className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/50"
              />
            </div>
          </div>
        );
      })()}

      <RenameDialog
        open={!!renamingBranchName}
        onOpenChange={(o) => { if (!o) setRenamingBranchName(null); }}
        title="Rename branch"
        initialValue={renamingBranchName ? getBranchLabel(commits, renamingBranchName, branchTitles) : ""}
        onSave={(v) => { if (renamingBranchName) onRenameBranch?.(renamingBranchName, v); setRenamingBranchName(null); }}
      />
    </div>
  );
}
