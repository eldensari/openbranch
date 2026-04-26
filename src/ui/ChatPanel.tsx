import { submitWaitlist } from "@/lib/llm";
import storage from "@/lib/storage";
import {
  getAttachmentSrc,
  readFileAsBase64,
  resizeImageFile,
} from "@/lib/attachments";
import { renderMd, renderCitationChips, renderResponseBlocks, SourceCard, ThinkingDots } from "./Markdown";
import ModelPicker from "./ModelPicker";
import Graph from "./Graph";
import {
  Copy,
  RotateCcw,
  ArrowUp,
  Paperclip,
  Globe,
  X,
  FileText,
  Square,
  Plus,
  Check,
  MoreHorizontal,
  GitBranch,
  Link2,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import RenameDialog from "./RenameDialog";
import MoveToFolderDialog from "./MoveToFolderDialog";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

type Props = any;

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function ChatPanel(props: Props) {
  const {
    commits, headId, branch, names, parentRef, thread,
    convs, convId, activeTags,
    input, setInput, inputRef, endRef,
    attachments, setAttachments,
    webSearchOn, toggleWebSearch,
    toast, setToast, showToast,
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
    send, merge, stop,
    copyToClipboard, retryResponse,
    checkout, startBranchFrom, startNew, deleteCommit,
    goToParent, goToChild, childRefs,
    handleSelectNode, rangeToBranch, rangeToNew, deleteRange,
    editNodeLabel, editCommitTags,
    del, countChildConvs, setConfirmDialog,
    renameBranch, requestDeleteBranch,
    renameConv, moveConvToFolder, clusters, expandFolder,
  } = props;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [renamingChat, setRenamingChat] = useState(false);
  const [movingChat, setMovingChat] = useState(false);

  const currentConv = convs.find((c: any) => c.id === convId);
  const currentTitle = currentConv?.title || "Untitled";

  const allSources = (() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const cm of thread) {
      for (const c of cm.citations || []) {
        if (!c?.url || seen.has(c.url)) continue;
        seen.add(c.url);
        out.push(c);
      }
    }
    return out;
  })();

  const onFilesPicked = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const existing = attachments || [];
    if (existing.length >= MAX_ATTACHMENTS) {
      showToast?.("You can attach up to " + MAX_ATTACHMENTS + " files per message.", "info");
      return;
    }
    const slots = MAX_ATTACHMENTS - existing.length;
    const picked = Array.from(files).slice(0, slots);
    const next = [...existing];
    let tooBig = 0, unsupported = 0;
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) { tooBig++; continue; }
      const isImage = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf";
      if (!isImage && !isPdf) { unsupported++; continue; }
      try {
        if (isImage) {
          const { data, mediaType } = await resizeImageFile(f);
          next.push({ type: "image", mediaType, name: f.name, data });
        } else {
          const data = await readFileAsBase64(f);
          next.push({ type: "pdf", mediaType: "application/pdf", name: f.name, data });
        }
      } catch {
        showToast?.("Failed to read " + f.name, "error");
      }
    }
    if (tooBig) showToast?.(tooBig + " file(s) exceeded 10MB and were skipped.", "info");
    if (unsupported) showToast?.(unsupported + " file(s) skipped (only images and PDFs supported).", "info");
    setAttachments(next);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((attachments || []).filter((_: unknown, i: number) => i !== idx));
  };

  const hasContent = (input && input.trim().length > 0) || (attachments && attachments.length > 0);

  const attachmentChipRow = attachments && attachments.length > 0 && (
    <div className="flex flex-wrap gap-2 border-b border-border/50 px-3 pt-3 pb-3">
      {attachments.map((a: any, i: number) => (
        <div
          key={i}
          className="group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted"
          title={a.name}
        >
          {a.type === "image" ? (
            <img
              src={getAttachmentSrc(a)}
              alt={a.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <FileText className="size-5 text-muted-foreground" />
          )}
          <button
            type="button"
            onClick={() => removeAttachment(i)}
            className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="Remove attachment"
          >
            <X className="size-2.5" />
          </button>
        </div>
      ))}
    </div>
  );

  const composer = (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-3xl border bg-card shadow-md transition-colors focus-within:shadow-lg",
        branchFromId || editId
          ? "ring-2 ring-[color:var(--branch-1)]/40 border-[color:var(--branch-1)]/50"
          : newFromRef
          ? "ring-2 ring-[color:var(--branch-1)]/40 border-[color:var(--branch-1)]/50"
          : mm
          ? "ring-2 ring-[color:var(--branch-5)]/40 border-[color:var(--branch-5)]/50"
          : "",
      )}
    >
      {attachmentChipRow}
      <div className="flex flex-col px-4 pt-3 pb-2">
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
          onPaste={async (e: any) => {
            const items = Array.from(e.clipboardData?.items || []) as DataTransferItem[];
            const files: File[] = [];
            for (const it of items) {
              if (it.kind === "file") {
                const f = it.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length) {
              e.preventDefault();
              const dt = new DataTransfer();
              files.forEach((f) => dt.items.add(f));
              await onFilesPicked(dt.files);
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
        <div className="mt-2 flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            className="hidden"
            onChange={async (e) => {
              await onFilesPicked(e.target.files);
              e.target.value = "";
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
                title="Add content"
                disabled={attachments?.length >= MAX_ATTACHMENTS}
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56 rounded-2xl p-1.5">
              <DropdownMenuItem
                onSelect={() => fileInputRef.current?.click()}
                disabled={attachments?.length >= MAX_ATTACHMENTS}
                className="gap-3 py-2.5"
              >
                <Paperclip className="size-4" />
                Upload a file
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={toggleWebSearch}
                className={cn(
                  "gap-3 py-2.5",
                  webSearchOn && "text-[color:var(--branch-1)] focus:text-[color:var(--branch-1)]",
                )}
              >
                <Globe
                  className={cn(
                    "size-4",
                    webSearchOn ? "text-[color:var(--branch-1)]" : "text-muted-foreground",
                  )}
                />
                Web search
                {webSearchOn && <Check className="ml-auto size-4 text-[color:var(--branch-1)]" />}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex-1" />
          <ModelPicker
            models={modelList}
            value={currentModel}
            onChange={(v: string) => { setModel(v); storage.set("model", v); }}
            thinking={thinkingOn}
            onThinkingChange={(v: boolean) => { setThinkingOn(v); storage.set("thinkingOn", v ? "1" : "0"); }}
          />
          {thinking ? (
            <Button
              onClick={stop}
              size="sm"
              variant="destructive"
              className="h-8 gap-1.5"
              title="Stop generation"
            >
              <Square className="size-3 fill-current" /> Stop
            </Button>
          ) : (
            <Button
              onClick={() => (mm && sel.length ? merge() : send())}
              disabled={!hasContent || (mm && !sel.length)}
              size="sm"
              className="h-8 gap-1.5"
            >
              {branchFromId ? "Branch" : editId ? "Edit" : mm ? "Merge" : newFromRef ? "Send" : (
                <>
                  Send <ArrowUp className="size-3.5" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const renderAttachments = (atts: any[]) => (
    <div className="mt-1 flex flex-wrap gap-1.5 justify-end">
      {atts.map((a, i) => {
        const src = getAttachmentSrc(a);
        return (
          <div
            key={i}
            className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border bg-background/60"
            title={a.name}
          >
            {a.type === "image" && src ? (
              <img src={src} alt={a.name} className="h-full w-full object-cover" />
            ) : (
              <FileText className="size-4 text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );

  const chatArea = (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <div className="min-w-0 flex-1">
          {convId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="group flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent"
                  title={currentTitle}
                >
                  <span className="truncate">{currentTitle}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => setRenamingChat(true)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMovingChat(true)}>
                  Move to folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!del}
                  onSelect={() => {
                    if (!del || !convId) return;
                    const n = countChildConvs ? countChildConvs(convId) : 0;
                    const msg = n > 0
                      ? `Delete this conversation and ${n} descendant conversation${n > 1 ? "s" : ""}?`
                      : "Delete this conversation?";
                    setConfirmDialog?.({ msg, onConfirm: () => del(convId) });
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              title="More"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 rounded-2xl p-1.5">
            <DropdownMenuItem
              onSelect={() => {
                setGraph(!graph);
                setSourcesOpen(false);
              }}
              className="gap-3 py-2.5"
            >
              <GitBranch className="size-4" />
              Graph
              {graph && <Check className="ml-auto size-4 text-[color:var(--branch-1)]" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setSourcesOpen(!sourcesOpen);
                if (!sourcesOpen) setGraph(false);
              }}
              disabled={allSources.length === 0}
              className="gap-3 py-2.5"
            >
              <Link2 className="size-4" />
              Sources
              {sourcesOpen && <Check className="ml-auto size-4 text-[color:var(--branch-1)]" />}
            </DropdownMenuItem>
            {convId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!del}
                  onSelect={() => {
                    if (!del || !convId) return;
                    const n = countChildConvs ? countChildConvs(convId) : 0;
                    const msg = n > 0
                      ? `Delete this conversation and ${n} descendant conversation${n > 1 ? "s" : ""}?`
                      : "Delete this conversation?";
                    if (setConfirmDialog) {
                      setConfirmDialog({ msg, onConfirm: () => del(convId) });
                    } else if (window.confirm(msg)) {
                      del(convId);
                    }
                  }}
                  className="gap-3 py-2.5"
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div
        className={cn(
          "flex-1 overflow-y-auto pt-6",
          thread.length === 0 && !pending && !newFromRef && "flex items-center",
        )}
      >
        {thread.length === 0 && !pending && !newFromRef ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4">
            <div className="flex flex-col items-center gap-8">
              <div className="text-3xl font-semibold tracking-tight">Where should we start?</div>
              <div className="w-full max-w-2xl">{composer}</div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-full w-full flex-col">
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4">
              {thread.map((cm: any) => {
                const isMrg = (cm.mergeIds || []).length > 0;
                return (
              <div
                key={cm.id}
                id={"cm-" + cm.id}
                className="group/cm flex flex-col gap-2"
                onMouseEnter={() => setHoveredCid(cm.id)}
                onMouseLeave={() => setHoveredCid(null)}
              >
                <div className="self-end max-w-[82%] flex flex-col items-end">
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
                  {cm.attachments?.length > 0 && renderAttachments(cm.attachments)}
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
                  <div className="text-[15px] leading-relaxed">
                    {cm.responseBlocks?.length
                      ? renderResponseBlocks(cm.responseBlocks)
                      : (
                        <>
                          {renderMd(cm.response)}
                          {cm.citations?.length > 0 && renderCitationChips(cm.citations)}
                        </>
                      )}
                  </div>
                  <div className="ml-2 flex gap-0.5 opacity-0 transition-opacity group-hover/cm:opacity-100 focus-within:opacity-100">
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
            <div className="self-start text-[15px] text-muted-foreground">
              <ThinkingDots />
            </div>
          )}
          <div ref={endRef} />
            </div>
            <div className="sticky bottom-0 z-10 mt-auto bg-background px-4 pb-5 pt-8">
              <div className="mx-auto w-full max-w-3xl">{composer}</div>
            </div>
          </div>
        )}
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


      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
          <div
            className={cn(
              "pointer-events-auto flex max-w-md items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur",
              toast.kind === "info"
                ? "border-[color:var(--branch-1)]/40 bg-[color:var(--branch-1)]/10 text-[color:var(--branch-1)]"
                : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <span className="text-sm font-medium">{toast.message}</span>
            <button
              type="button"
              className="shrink-0 opacity-70 hover:opacity-100"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <RenameDialog
        open={renamingChat}
        onOpenChange={setRenamingChat}
        title="Rename chat"
        initialValue={currentTitle}
        onSave={(v) => { if (convId) renameConv?.(convId, v); }}
      />
      <MoveToFolderDialog
        open={movingChat}
        onOpenChange={setMovingChat}
        clusters={clusters || []}
        convId={convId}
        onMove={moveConvToFolder}
        onAfterMove={(fid) => { if (fid) expandFolder?.(fid); }}
      />
    </div>
  );

  const graphArea = graph && commits.length > 0 && (
    <div className="flex h-full flex-col overflow-hidden bg-graph-bg">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-graph-bg px-3">
        <span className="text-base font-medium">Graph</span>
        <div className="flex items-center gap-1.5">
          {mm && (
            <span className="rounded-full bg-[color:var(--branch-5)] px-2 py-0.5 text-[10px] font-medium text-white">
              Select commits
            </span>
          )}
          {selectMode && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
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
              className="h-7 rounded-full px-2.5 text-xs"
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
              className="h-7 rounded-full px-2.5 text-xs"
            >
              Merge
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-2 size-7"
            onClick={() => setGraph(false)}
            title="Cancel"
          >
            <X className="size-4" />
          </Button>
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
        onRenameBranch={(b: string, newTitle: string) => renameBranch(convId, b, newTitle)}
        onDeleteBranch={(b: string) => requestDeleteBranch(b)}
      />
    </div>
  );

  const sourcesArea = sourcesOpen && allSources.length > 0 && (
    <div className="flex h-full flex-col overflow-hidden bg-graph-bg">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-base font-medium">Sources</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => setSourcesOpen(false)}
          title="Cancel"
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {allSources.map((c: any, i: number) => (
          <SourceCard key={i} c={c} />
        ))}
      </div>
    </div>
  );

  const rightArea = sourcesArea || graphArea;
  if (!rightArea) return chatArea;

  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={65} minSize={30}>{chatArea}</ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={35} minSize={20} maxSize={55}>
        {rightArea}
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
