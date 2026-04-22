import { bCol } from "../theme";
import { submitWaitlist } from "../lib/llm";
import storage from "../lib/storage";
import herbIcon from "../assets/herb.svg";
import { renderMd, ThinkingDots } from "./Markdown";
import IconBtn from "./IconBtn";
import ModelPicker from "./ModelPicker";
import Graph from "./Graph";

export default function ChatPanel({
  t, dark,
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
  rateLimited, hasKey, waitlistStatus, setWaitlistStatus, waitlistEmail, setWaitlistEmail,
  apiKey, setKeyDraft, setShowKeyInput, setRateLimited,
  send, merge,
  copyToClipboard, retryResponse,
  checkout, startBranchFrom, startNew, deleteCommit,
  goToParent, goToChild, childRefs,
  handleSelectNode, rangeToBranch, rangeToNew, deleteRange,
  editNodeLabel, editCommitTags,
}) {
  return (
    <>
      {/* CENTER */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "7px 12px", borderBottom: "0.5px solid " + t.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: t.text, display: "flex", alignItems: "center", gap: 6 }}><img src={herbIcon} alt="" style={{ width: 20, height: 20 }} /> OpenBranch</span>
            {names.length > 0 && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, background: bCol(names, branch) + "18", color: bCol(names, branch), fontWeight: 500, fontFamily: "monospace" }}>{branch}</span>}
            {parentRef && <span onClick={goToParent} style={{ fontSize: 8, color: "#378ADD", cursor: "pointer" }}>{"↗"} from: {parentRef.convTitle?.slice(0, 20)}</span>}
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

        {/* Mode indicators — centered and width-matched to input below */}
        {(branchFromId || editId || newFromRef || (mm && sel.length > 0) || undoAction) && (
          <div style={{ padding: "0 16px", display: "flex", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: 760 }}>
              {branchFromId && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: t.userBubble, display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: t.userText, fontWeight: 500 }}>Branch from selected point</span>
                <button onClick={() => { setBranchFromId(null); setInput(""); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
              </div>}
              {editId && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: t.userBubble, display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: t.userText, fontWeight: 500 }}>Editing — new branch</span>
                <button onClick={() => { setEditId(null); setInput(""); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
              </div>}
              {newFromRef && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: "#f0f6ff", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: "#378ADD", fontWeight: 500 }}>New conversation from {newFromRef.promptSummary?.slice(0, 25)}..</span>
                <button onClick={() => { setNewFromRef(null); setInput(""); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
              </div>}
              {mm && sel.length > 0 && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: t.mergeBubble, display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: t.mergeText, fontWeight: 500 }}>Merging {sel.length} into {branch}</span>
                <button onClick={() => { setMm(false); setSel([]); }} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
              </div>}
              {undoAction && <div style={{ padding: "6px 12px", borderTop: "0.5px solid " + t.border, background: dark ? "#122033" : "#EAF3FF", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 4 }}>
                <span style={{ fontSize: 11, color: dark ? "#9CCBFF" : "#1F6FB2", fontWeight: 500 }}>{undoAction.label}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={restoreUndo} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: "transparent", border: "0.5px solid " + (dark ? "#33567A" : "#A8CFFF"), cursor: "pointer", color: dark ? "#C7E2FF" : "#1F6FB2" }}>Undo</button>
                  <button onClick={() => setUndoAction(null)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 3, background: dark ? "#1F6FB2" : "#378ADD", border: "0.5px solid " + (dark ? "#2E7FC9" : "#378ADD"), cursor: "pointer", color: "#fff" }}>Done</button>
                </div>
              </div>}
            </div>
          </div>
        )}

        {/* Rate limit banner */}
        {rateLimited && !hasKey && (
          <div style={{ padding: "10px 14px", borderTop: "0.5px solid " + t.border, background: dark ? "#2a1a0e" : "#fef9ef" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: dark ? "#f0c060" : "#854F0B", marginBottom: 6 }}>
              You've reached the free message limit. Enter your API key to continue, or leave your email for updates.
            </div>
            {waitlistStatus === "done" ? (
              <div style={{ fontSize: 11, color: "#1D9E75", fontWeight: 500 }}>{"✓"} You're on the list! We'll reach out soon.</div>
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
          <Graph commits={commits} headId={headId} activeBranch={branch} names={names} onCheckout={checkout} onBranch={startBranchFrom} onNew={startNew} onDelete={deleteCommit} mergeMode={mm} selected={sel} onToggleSel={id => setSel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])} selectMode={selectMode} selectedRangeIds={selectedRangeIds} onSelectNode={handleSelectNode} onRangeBranch={rangeToBranch} onRangeNew={rangeToNew} onRangeDelete={deleteRange} parentRef={parentRef} onGoToParent={goToParent} childRefs={childRefs} onGoToChild={goToChild} hoveredCid={hoveredCid} panelW={graphW} t={t} branchTitles={convs.find(c => c.id === convId)?.branchTitles || {}} onEditLabel={editNodeLabel} onEditTags={editCommitTags} allTags={Array.from(new Set(convs.flatMap(cv => (cv.commits || []).flatMap(c => c.tags || []))))} activeTags={activeTags} />
        </div>
      )}
    </>
  );
}
