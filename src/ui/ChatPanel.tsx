import { bCol } from "@/lib/branch-colors";
import { submitWaitlist } from "@/lib/llm";
import storage from "@/lib/storage";
import herbIcon from "@/assets/herb.svg";
import { renderMd, ThinkingDots } from "./Markdown";
import ModelPicker from "./ModelPicker";
import Graph from "./Graph";
import { Copy, RotateCcw, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

type Props = any;

export default function ChatPanel(props: Props) {
  const {
    commits, headId, branch, names, parentRef, thread,
    convs, convId, activeTags,
    input, setInput, inputRef, endRef,
    pending, thinking, newFromRef, setNewFromRef,
    editId, setEditId, startEdit,
    branchFromId, setBranchFromId,
    mm, setMm, sel, setSel,
    hoveredCid, setHoveredCid,
    graph, setGraph,
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
  } = props;

  const branchColor = names.length > 0 ? bCol(names, branch) : "var(--muted-foreground)";

  const composer = (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card px-4 pt-3 pb-2 shadow-sm transition-colors",
        branchFromId || editId
          ? "ring-2 ring-[color:var(--branch-1)]/40 border-[color:var(--branch-1)]/50"
          : newFromRef
          ? "ring-2 ring-[color:var(--branch-1)]/40 border-[color:var(--branch-1)]/50"
          : mm
          ? "ring-2 ring-[color:var(--branch-5)]/40 border-[color:var(--branch-5)]/50"
          : "",
      )}
    >
      <Textarea
        ref={inputRef}
        value={input}
        onChange={(e: any) => setInput(e.target.value)}
        onKeyDown={(e: any) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (mm && sel.length) { merge(); return; }
            if (e.metaKey || e.ctrlKey) { send(true); return; }
            send(false);
          }
        }}
        placeholder={
          branchFromId ? "Write the first message for this branch..."
          : editId ? "Edit your question..."
          : newFromRef ? "Start new conversation..."
          : mm ? "Merge instruction..."
          : thread.length === 0 ? "How can I help you today?"
          : "Reply..."
        }
        rows={1}
        className="min-h-[48px] resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 md:text-base"
        onInput={(e: any) => {
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 240) + "px";
        }}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <div />
        <div className="flex items-center gap-1">
          <ModelPicker
            models={modelList}
            value={currentModel}
            onChange={(v: string) => { setModel(v); storage.set("model", v); }}
            thinking={thinkingOn}
            onThinkingChange={(v: boolean) => { setThinkingOn(v); storage.set("thinkingOn", v ? "1" : "0"); }}
          />
          <Button
            onClick={() => (mm && sel.length ? merge() : send())}
            disabled={thinking || !input.trim() || (mm && !sel.length)}
            size="sm"
            className="gap-1.5"
          >
            {branchFromId ? "Branch" : editId ? "Edit" : mm ? "Merge" : newFromRef ? "Send" : (
              <>
                Send <ArrowUp className="size-3.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  const chatArea = (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-base font-semibold">
            <img src={herbIcon} alt="" className="size-5" /> OpenBranch
          </span>
          {names.length > 0 && (
            <span
              className="rounded-md px-2 py-0.5 font-mono text-xs font-medium"
              style={{
                color: branchColor,
                background: `color-mix(in oklch, ${branchColor} 14%, transparent)`,
              }}
            >
              {branch}
            </span>
          )}
          {parentRef && (
            <button
              onClick={goToParent}
              className="text-xs text-[color:var(--branch-1)] hover:underline"
            >
              ↗ from: {parentRef.convTitle?.slice(0, 20)}
            </button>
          )}
        </div>
        {commits.length > 0 && (
          <Button variant={graph ? "default" : "outline"} size="sm" onClick={() => setGraph(!graph)}>
            {graph ? "Hide graph" : "Show graph"}
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {thread.length === 0 && !pending && !newFromRef && (
            <div className="flex flex-1 flex-col items-center justify-center gap-8 py-16">
              <div className="text-center">
                <div className="text-3xl font-semibold tracking-tight">Where should we start?</div>
              </div>
              <div className="w-full max-w-2xl">{composer}</div>
            </div>
          )}
          {thread.map((cm: any) => {
            const isMrg = (cm.mergeIds || []).length > 0;
            return (
              <div
                key={cm.id}
                id={"cm-" + cm.id}
                className="flex flex-col gap-2"
                onMouseEnter={() => setHoveredCid(cm.id)}
                onMouseLeave={() => setHoveredCid(null)}
              >
                <div className="self-end max-w-[82%]">
                  <div
                    className={cn(
                      "rounded-2xl px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap",
                      isMrg
                        ? "border-l-[3px] border-[color:var(--branch-5)] bg-merge-bubble text-merge-foreground"
                        : "bg-user-bubble text-user-foreground",
                    )}
                  >
                    {isMrg && (
                      <div className="mb-1 text-[11px] font-semibold text-[color:var(--branch-5)]">MERGE</div>
                    )}
                    {cm.prompt}
                  </div>
                  <div className="mt-0.5 flex justify-end">
                    <button
                      onClick={() => startEdit(cm.id)}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                        editId === cm.id
                          ? "text-[color:var(--user-foreground)]"
                          : "text-muted-foreground/70 hover:text-[color:var(--user-foreground)]",
                      )}
                    >
                      edit
                    </button>
                  </div>
                </div>
                <div className="self-start max-w-[82%] flex flex-col gap-1.5">
                  <div className="rounded-2xl bg-ai-bubble px-4 py-3 text-[15px] leading-relaxed text-ai-foreground">
                    {renderMd(cm.response)}
                  </div>
                  <div className="ml-2 flex gap-0.5 opacity-50 transition-opacity hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      title="Copy"
                      onClick={() => copyToClipboard(cm.response)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      title="Retry"
                      onClick={() => retryResponse(cm.id)}
                      disabled={thinking}
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          {pending && (
            <div
              className={cn(
                "self-end max-w-[82%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                newFromRef ? "bg-[color:var(--branch-1)]/12 text-[color:var(--branch-1)]" : "bg-user-bubble text-user-foreground",
              )}
            >
              {pending}
            </div>
          )}
          {thinking && (
            <div className="self-start rounded-2xl bg-ai-bubble px-4 py-3 text-[15px] text-muted-foreground">
              <ThinkingDots />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {(branchFromId || editId || newFromRef || (mm && sel.length > 0) || undoAction) && (
        <div className="mx-auto w-full max-w-3xl px-4">
          {branchFromId && (
            <ModeBanner
              label="Branch from selected point"
              tone="user"
              onCancel={() => { setBranchFromId(null); setInput(""); }}
            />
          )}
          {editId && (
            <ModeBanner
              label="Editing — new branch"
              tone="user"
              onCancel={() => { setEditId(null); setInput(""); }}
            />
          )}
          {newFromRef && (
            <ModeBanner
              label={`New conversation from ${newFromRef.promptSummary?.slice(0, 25)}..`}
              tone="blue"
              onCancel={() => { setNewFromRef(null); setInput(""); }}
            />
          )}
          {mm && sel.length > 0 && (
            <ModeBanner
              label={`Merging ${sel.length} into ${branch}`}
              tone="merge"
              onCancel={() => { setMm(false); setSel([]); }}
            />
          )}
          {undoAction && (
            <div className="mb-2 flex items-center justify-between rounded-md border bg-[color:var(--branch-1)]/12 px-3 py-2">
              <span className="text-sm font-medium text-[color:var(--branch-1)]">{undoAction.label}</span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" onClick={restoreUndo} className="h-7">Undo</Button>
                <Button size="sm" onClick={() => setUndoAction(null)} className="h-7">Done</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {rateLimited && !hasKey && (
        <div className="border-t bg-merge-bubble px-4 py-3">
          <div className="mb-2 text-sm font-medium text-merge-foreground">
            You've reached the free message limit. Enter your API key to continue, or leave your email for updates.
          </div>
          {waitlistStatus === "done" ? (
            <div className="text-sm font-medium text-[color:var(--branch-0)]">✓ You're on the list! We'll reach out soon.</div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={waitlistEmail}
                onChange={(e) => setWaitlistEmail(e.target.value)}
                placeholder="your@email.com"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && waitlistEmail.trim()) {
                    setWaitlistStatus("sending");
                    submitWaitlist(waitlistEmail.trim())
                      .then((r: any) => setWaitlistStatus(r.ok ? "done" : "error"))
                      .catch(() => setWaitlistStatus("error"));
                  }
                }}
                className="h-8"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (!waitlistEmail.trim()) return;
                  setWaitlistStatus("sending");
                  submitWaitlist(waitlistEmail.trim())
                    .then((r: any) => setWaitlistStatus(r.ok ? "done" : "error"))
                    .catch(() => setWaitlistStatus("error"));
                }}
                disabled={waitlistStatus === "sending" || !waitlistEmail.trim()}
              >
                {waitlistStatus === "sending" ? "..." : "Notify me"}
              </Button>
            </div>
          )}
          {waitlistStatus === "error" && (
            <div className="mt-1 text-xs text-destructive">Something went wrong. Try again.</div>
          )}
          <button
            onClick={() => {
              setKeyDraft(apiKey);
              setShowKeyInput(true);
              setRateLimited(false);
            }}
            className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Enter API key instead
          </button>
        </div>
      )}

      {(thread.length > 0 || pending || newFromRef) && (
        <div className="shrink-0 border-t px-4 pb-5 pt-3">
          <div className="mx-auto w-full max-w-3xl">{composer}</div>
        </div>
      )}
    </div>
  );

  const graphArea = graph && commits.length > 0 && (
    <div className="flex h-full flex-col overflow-hidden bg-graph-bg">
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-sm font-medium text-muted-foreground">Graph</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground/80">
            HEAD {headId?.slice(0, 7)}
          </span>
          {!mm && (
            <Button
              size="sm"
              variant={selectMode ? "default" : "outline"}
              onClick={() => {
                setSelectMode((p: boolean) => !p);
                setMm(false);
                setSel([]);
                clearSelectRange();
              }}
              className="h-7 px-2 text-xs"
            >
              Select
            </Button>
          )}
          {names.length > 1 && !mm && !selectMode && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSelectMode(false);
                clearSelectRange();
                setMm(true);
                setSel([]);
              }}
              className="h-7 px-2 text-xs"
              style={{ color: "var(--branch-5)", borderColor: "var(--branch-5)" }}
            >
              Merge
            </Button>
          )}
          {mm && (
            <span className="rounded-md bg-[color:var(--branch-5)] px-2 py-0.5 text-[10px] font-medium text-white">
              Select commits
            </span>
          )}
          {selectMode && (
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-medium",
                selectError ? "bg-destructive/10 text-destructive" : "bg-[color:var(--branch-1)]/15 text-[color:var(--branch-1)]",
              )}
            >
              {selectError ||
                (selectRange.endId
                  ? selectedRangeIds.length + " selected"
                  : selectRange.startId
                  ? "Pick end"
                  : "Pick start")}
            </span>
          )}
        </div>
      </div>
      <Graph
        commits={commits}
        headId={headId}
        activeBranch={branch}
        names={names}
        onCheckout={checkout}
        onBranch={startBranchFrom}
        onNew={startNew}
        onDelete={deleteCommit}
        mergeMode={mm}
        selected={sel}
        onToggleSel={(id: string) =>
          setSel((p: string[]) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
        }
        selectMode={selectMode}
        selectedRangeIds={selectedRangeIds}
        onSelectNode={handleSelectNode}
        onRangeBranch={rangeToBranch}
        onRangeNew={rangeToNew}
        onRangeDelete={deleteRange}
        parentRef={parentRef}
        onGoToParent={goToParent}
        childRefs={childRefs}
        onGoToChild={goToChild}
        hoveredCid={hoveredCid}
        panelW={360}
        branchTitles={convs.find((c: any) => c.id === convId)?.branchTitles || {}}
        onEditLabel={editNodeLabel}
        onEditTags={editCommitTags}
        allTags={Array.from(
          new Set(convs.flatMap((cv: any) => (cv.commits || []).flatMap((c: any) => c.tags || []))),
        )}
        activeTags={activeTags}
      />
    </div>
  );

  if (!graphArea) return chatArea;

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={65} minSize={30}>{chatArea}</ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={35} minSize={20} maxSize={55}>
        {graphArea}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function ModeBanner({ label, tone, onCancel }: { label: string; tone: "user" | "merge" | "blue"; onCancel: () => void }) {
  const toneClass =
    tone === "merge"
      ? "bg-merge-bubble text-merge-foreground"
      : tone === "blue"
      ? "bg-[color:var(--branch-1)]/12 text-[color:var(--branch-1)]"
      : "bg-user-bubble text-user-foreground";
  return (
    <div className={cn("mb-2 flex items-center justify-between rounded-md border px-3 py-2", toneClass)}>
      <span className="text-sm font-medium">{label}</span>
      <Button size="sm" variant="outline" className="h-7" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
