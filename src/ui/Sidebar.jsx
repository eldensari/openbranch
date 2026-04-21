import storage from "../lib/storage";
import { detectProvider } from "../lib/llm";
import { getBranchLabel, buildBranchTree, getBranchDescendantNames } from "../graph/branches";
import { sidebarBranchKey, buildSidebarLayout } from "../storage/sidebar";
import { SunIcon, MoonIcon, GitHubIcon } from "./icons";

export default function Sidebar({
  t, dark, setDark,
  convs, clusters, clusterGroups,
  convId, branch,
  activeTags, setActiveTags,
  chatMenu, setChatMenu,
  renamingId, setRenamingId,
  renamingBranch, setRenamingBranch,
  setRenamingClusterId,
  renameVal, setRenameVal,
  collapsedClusters, toggleCluster,
  sidebarItemOpen, toggleSidebarItem,
  apiKey, setApiKey, showKeyInput, setShowKeyInput, keyDraft, setKeyDraft, hasKey, setRateLimited,
  newConv, loadMain, loadBranch,
  renameConv, renameBranch, del, countChildConvs, deleteBranchCascade,
  setConfirmDialog,
}) {
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
              style={{ opacity: 0, fontSize: 14, color: t.textMuted, padding: "0 4px", cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0, lineHeight: 1 }}>{"⋯"}</span>}
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
            style={{ opacity: 0, fontSize: 14, color: t.textMuted, padding: "0 4px", cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0, lineHeight: 1 }}>{"⋯"}</span>}
        </div>
        {showBranches && rootBranches.map(renderBranchNode)}
      </div>
    );
  };

  const tagCounts = {};
  convs.forEach(cv => (cv.commits || []).forEach(c => (c.tags || []).forEach(tg => { tagCounts[tg] = (tagCounts[tg] || 0) + 1; })));
  const tagEntries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  const liveTags = new Set();
  convs.forEach(cv => (cv.commits || []).forEach(c => (c.tags || []).forEach(tg => liveTags.add(tg))));
  const liveActive = new Set([...activeTags].filter(tg => liveTags.has(tg)));
  const convHasAnyTag = cv => (cv.commits || []).some(c => (c.tags || []).some(tg => liveActive.has(tg)));
  const filteredGroups = liveActive.size
    ? clusterGroups.map(g => ({ ...g, items: g.items.filter(convHasAnyTag) })).filter(g => g.items.length)
    : clusterGroups;

  return (
    <div style={{ width: 180, display: "flex", flexDirection: "column", borderRight: "0.5px solid " + t.border, background: t.sidebar }}>
      <div style={{ padding: "8px 6px" }}><button onClick={newConv} style={{ width: "100%", padding: "6px", fontSize: 10, fontWeight: 500, borderRadius: 4, background: t.accent, color: t.accentText, border: "none", cursor: "pointer" }}>+ New</button></div>
      {tagEntries.length > 0 && (
        <div style={{ padding: "4px 8px 8px", borderBottom: "0.5px solid " + t.border, marginBottom: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: t.textSub, padding: "4px 2px 6px" }}>Tags</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {tagEntries.map(([tg, n]) => {
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
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 4px 4px" }} onClick={() => setChatMenu(null)}>
        {filteredGroups.map(group => {
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
        })}
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
            {keyDraft.trim() && detectProvider(keyDraft) && <div style={{ fontSize: 8, color: detectProvider(keyDraft).color, fontWeight: 500 }}>{"✓"} {detectProvider(keyDraft).name}</div>}
            {keyDraft.trim() && !detectProvider(keyDraft) && <div style={{ fontSize: 8, color: "#c00" }}>{"✗"} Unknown format</div>}
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
  );
}
