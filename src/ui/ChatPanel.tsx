import { submitWaitlist } from "@/lib/llm";
import storage from "@/lib/storage";
import {
  getAttachmentSrc,
  readFileAsBase64,
  resizeImageFile,
} from "@/lib/attachments";
import { Favicon, getHost, renderMd, renderCitationChips, renderResponseBlocks, SourceCard, ThinkingDots } from "./Markdown";
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
  ChevronRight,
  GitBranch,
  GitMerge,
  Link2,
  ChevronDown,
  MoreHorizontal,
  MousePointerSquareDashed,
  PanelRight,
  Pencil,
  Folder,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
const RIGHT_PANEL_DEFAULT_PX = 360;
const RIGHT_PANEL_MIN_PX = 300;
const RIGHT_PANEL_MAX_PX = 480;
const RIGHT_PANEL_NARROW_MIN_PX = 240;
const CHAT_PROTECTED_PX = 680;

function pct(px: number, total: number) {
  return total > 0 ? (px / total) * 100 : 0;
}

function getRightPanelSizes(totalWidth: number) {
  if (!totalWidth) return { defaultSize: 30, minSize: 20, maxSize: 40 };

  const maxForChat = totalWidth - CHAT_PROTECTED_PX;
  const maxPx = Math.min(
    RIGHT_PANEL_MAX_PX,
    Math.max(RIGHT_PANEL_NARROW_MIN_PX, maxForChat),
  );
  const minPx = Math.min(RIGHT_PANEL_MIN_PX, maxPx);
  const defaultPx = Math.min(Math.max(RIGHT_PANEL_DEFAULT_PX, minPx), maxPx);

  return {
    defaultSize: pct(defaultPx, totalWidth),
    minSize: pct(minPx, totalWidth),
    maxSize: pct(maxPx, totalWidth),
  };
}

export default function ChatPanel(props: Props) {
  const {
    commits, headId, branch, names, parentRef, thread,
    convs, convId, activeTags, tagPool,
    input, setInput, inputRef, endRef,
    attachments, setAttachments,
    webSearchOn, toggleWebSearch,
    toast, setToast, showToast,
    pending, streamingDraft, thinking, newFromRef, setNewFromRef,
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
  const panelGroupRef = useRef<HTMLDivElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [sourceCommitId, setSourceCommitId] = useState<string | null>(null);
  const [panelGroupWidth, setPanelGroupWidth] = useState(0);
  const [renamingChat, setRenamingChat] = useState(false);
  const [movingChat, setMovingChat] = useState(false);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [openThoughtIds, setOpenThoughtIds] = useState<Set<string>>(() => new Set());

  const thoughtKey = (ownerId: string, activityId: string) => ownerId + "::" + activityId;
  const thoughtElementId = (ownerId: string, activityId: string) =>
    "thought-" + thoughtKey(ownerId, activityId).replace(/[^a-zA-Z0-9_-]/g, "-");
  const toggleThought = (ownerId: string, activityId: string) => {
    const key = thoughtKey(ownerId, activityId);
    setOpenThoughtIds((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };
  const openThought = (ownerId: string, activityId: string) => {
    const key = thoughtKey(ownerId, activityId);
    setOpenThoughtIds((prev) => new Set(prev).add(key));
    window.setTimeout(() => {
      document
        .getElementById(thoughtElementId(ownerId, activityId))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 30);
  };

  const beginInlineEdit = (cm: any) => {
    setInlineEditId(cm.id);
    startEdit(cm.id);
  };
  const cancelInlineEdit = () => {
    setInlineEditId(null);
    setEditId(null);
    setInput("");
  };
  const sendInlineEdit = () => {
    setInlineEditId(null);
    send();
  };

  const currentConv = convs.find((c: any) => c.id === convId);
  const currentTitle = currentConv?.title || "Untitled";

  const getCommitSources = (cm: any) => {
    const seen = new Set<string>();
    const out: any[] = [];
    const add = (c: any) => {
      if (!c?.url || seen.has(c.url)) return;
      seen.add(c.url);
      out.push(c);
    };

    for (const c of cm?.citations || []) add(c);
    for (const b of cm?.responseBlocks || []) {
      for (const c of b?.citations || []) add(c);
    }

    return out;
  };

  const allSources = (() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const cm of thread) {
      for (const c of getCommitSources(cm)) {
        if (!c?.url || seen.has(c.url)) continue;
        seen.add(c.url);
        out.push(c);
      }
    }
    return out;
  })();
  const sourceCommit = sourceCommitId
    ? thread.find((cm: any) => cm.id === sourceCommitId)
    : null;
  const visibleSources = sourceCommitId
    ? sourceCommit ? getCommitSources(sourceCommit) : []
    : allSources;

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
          className="field-sizing-fixed min-h-[48px] resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 md:text-base"
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
            <DropdownMenuContent align="start" side="top" className="min-w-[14rem] rounded-2xl p-1">
              <DropdownMenuItem
                onSelect={() => fileInputRef.current?.click()}
                disabled={attachments?.length >= MAX_ATTACHMENTS}
                className="gap-3 py-2"
              >
                <Paperclip className="size-4" />
                Upload a file
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={toggleWebSearch}
                className={cn(
                  "gap-3 py-2",
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

  const graphActionsMenu = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Actions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[14rem] rounded-2xl p-1">
        <DropdownMenuItem
          onSelect={() => {
            setSelectMode((p: boolean) => !p);
            setMm(false);
            setSel([]);
            clearSelectRange();
          }}
          className="gap-3 py-2 text-base"
        >
          <MousePointerSquareDashed className="size-4" />
          Select
          {selectMode && <Check className="ml-auto size-4 text-[color:var(--branch-1)]" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            setSelectMode(false);
            clearSelectRange();
            setMm(true);
            setSel([]);
          }}
          disabled={names.length <= 1}
          className="gap-3 py-2 text-base"
        >
          <GitMerge className="size-4" />
          Merge
          {mm && <Check className="ml-auto size-4 text-[color:var(--branch-1)]" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const panelSwitcher = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <PanelRight className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Views</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[14rem] rounded-2xl p-1">
        <DropdownMenuItem
          onSelect={() => { setGraph(!graph); setSourcesOpen(false); setSourceCommitId(null); }}
          className="gap-3 py-2 text-base"
        >
          <GitBranch className="size-4" />
          Graph
          {graph && <Check className="ml-auto size-4 text-[color:var(--branch-1)]" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            const showingAllSources = sourcesOpen && sourceCommitId === null;
            setSourceCommitId(null);
            setSourcesOpen(!showingAllSources);
            if (!showingAllSources) setGraph(false);
          }}
          disabled={allSources.length === 0}
          className="gap-3 py-2 text-base"
        >
          <Link2 className="size-4" />
          Sources
          {sourcesOpen && <Check className="ml-auto size-4 text-[color:var(--branch-1)]" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
                  className="group flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-base font-medium hover:bg-accent"
                  title={currentTitle}
                >
                  <span className="truncate">{currentTitle}</span>
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[14rem] rounded-2xl p-1">
                <DropdownMenuItem onSelect={() => setRenamingChat(true)} className="gap-3 py-2">
                  <Pencil className="size-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMovingChat(true)} className="gap-3 py-2">
                  <Folder className="size-4" />
                  Move to project
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={!del}
                  onSelect={() => {
                    if (!del || !convId) return;
                    const n = countChildConvs ? countChildConvs(convId) : 0;
                    setConfirmDialog?.({
                      title: "Delete chat?",
                      body: <>This will delete <span className="font-semibold">{currentTitle}</span>.</>,
                      note: n > 0 ? `Also deletes ${n} descendant conversation${n > 1 ? "s" : ""}.` : null,
                      confirmLabel: "Delete",
                      onConfirm: () => del(convId),
                    });
                  }}
                  className="gap-3 py-2"
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!graph && !sourcesOpen && panelSwitcher}
      </div>
      <div
        className={cn(
          "flex-1 overflow-y-auto",
          thread.length === 0 && !pending && !newFromRef
            ? "flex items-start pt-[30vh]"
            : "pt-14",
        )}
      >
        {thread.length === 0 && !pending && !newFromRef ? (
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-6">
            <div className="flex flex-col items-center gap-8">
              <div className="text-3xl font-semibold tracking-tight">Where should we start?</div>
              <div className="w-full max-w-[760px]">{composer}</div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-full w-full flex-col">
            <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-8 px-6">
              {thread.map((cm: any) => {
                const isMrg = (cm.mergeIds || []).length > 0;
                const cmSources = getCommitSources(cm);
                return (
              <div
                key={cm.id}
                id={"cm-" + cm.id}
                className={cn("group/cm flex flex-col", inlineEditId === cm.id ? "gap-8" : "gap-4")}
                onMouseEnter={() => setHoveredCid(cm.id)}
                onMouseLeave={() => setHoveredCid(null)}
              >
                <div
                  className={cn(
                    "flex flex-col items-end",
                    inlineEditId === cm.id ? "w-full" : "self-end max-w-[82%]",
                  )}
                >
                  {inlineEditId === cm.id ? (
                    <div className="w-full rounded-2xl bg-user-bubble text-user-foreground px-4 py-3">
                      <Textarea
                        autoFocus
                        value={input}
                        onChange={(e: any) => setInput(e.target.value)}
                        onKeyDown={(e: any) => {
                          if (e.key === "Escape") { e.preventDefault(); cancelInlineEdit(); }
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendInlineEdit(); }
                        }}
                        rows={1}
                        className="min-h-[24px] resize-none border-0 bg-transparent p-0 text-[16px] leading-relaxed shadow-none focus-visible:ring-0 md:text-[16px]"
                        onInput={(e: any) => {
                          e.target.style.height = "auto";
                          e.target.style.height = Math.min(e.target.scrollHeight, 320) + "px";
                        }}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={cancelInlineEdit} className="h-8 rounded-full px-4">
                          Cancel
                        </Button>
                        <Button size="sm" onClick={sendInlineEdit} disabled={!(input && input.trim())} className="h-8 rounded-full px-4">
                          Send
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <ContextMenu>
                        <ContextMenuTrigger asChild>
                          <div
                            className={cn(
                              "rounded-2xl px-4 py-3 text-[16px] leading-relaxed whitespace-pre-wrap",
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
                        </ContextMenuTrigger>
                        <ContextMenuContent className="min-w-[12rem] rounded-2xl p-1">
                          <ContextMenuItem onSelect={() => copyToClipboard(cm.prompt)} className="gap-3 py-2">
                            <Copy className="size-4" />
                            Copy
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => beginInlineEdit(cm)} className="gap-3 py-2">
                            <Pencil className="size-4" />
                            Edit
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => startBranchFrom(cm.id)} className="gap-3 py-2">
                            <GitBranch className="size-4" />
                            Branch
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => startNew(cm.id)} className="gap-3 py-2">
                            <Plus className="size-4" />
                            New
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() => {
                              setConfirmDialog?.({
                                title: "Delete commit?",
                                body: <>This will delete this commit and all its children.</>,
                                confirmLabel: "Delete",
                                onConfirm: () => deleteCommit(cm.id),
                              });
                            }}
                            className="gap-3 py-2"
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                      {cm.attachments?.length > 0 && renderAttachments(cm.attachments)}
                      <div className="mt-1 flex justify-end gap-0.5 opacity-0 transition-opacity group-hover/cm:opacity-100 focus-within:opacity-100">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground"
                              onClick={() => copyToClipboard(cm.prompt)}
                            >
                              <Copy className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Copy</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground"
                              onClick={() => beginInlineEdit(cm)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Edit</TooltipContent>
                        </Tooltip>
                      </div>
                    </>
                  )}
                </div>
                <div className="self-start w-full flex flex-col gap-1">
                  <ThinkingPanel thinking={cm.thinking} isStreaming={false} />
                  <ThoughtStream
                    ownerId={cm.id}
                    activities={cm.activities || []}
                    openThoughtIds={openThoughtIds}
                    onToggleThought={toggleThought}
                    getThoughtKey={thoughtKey}
                    getThoughtElementId={thoughtElementId}
                  />
                  <div className="text-[16px] leading-relaxed">
                    {cm.responseBlocks?.length
                      ? renderResponseBlocks(cm.responseBlocks)
                      : (
                        <>
                          {renderMd(cm.response)}
                          {cm.citations?.length > 0 && renderCitationChips(cm.citations)}
                        </>
                      )}
                  </div>
                  <div className="-ml-2 mt-1 flex gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          onClick={() => copyToClipboard(cm.response)}
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Copy</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          onClick={() => retryResponse(cm.id)}
                          disabled={thinking}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Retry</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          onClick={() => startBranchFrom(cm.id)}
                        >
                          <GitBranch className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Branch</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          onClick={() => startNew(cm.id)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">New</TooltipContent>
                    </Tooltip>
                    {cmSources.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-pressed={sourcesOpen && sourceCommitId === cm.id}
                            className={cn(
                              "h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground",
                              sourcesOpen && sourceCommitId === cm.id && "bg-accent text-foreground",
                            )}
                            onClick={() => {
                              setSourceCommitId(cm.id);
                              setSourcesOpen(true);
                              setGraph(false);
                            }}
                          >
                            <SourceIconStack sources={cmSources} />
                            <span className="text-[13px]">Sources</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Sources</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {pending && (
            <div
              className={cn(
                "self-end max-w-[82%] rounded-2xl px-4 py-3 text-[16px] leading-relaxed",
                newFromRef ? "bg-[color:var(--branch-1)]/12 text-[color:var(--branch-1)]" : "bg-user-bubble text-user-foreground",
              )}
            >
              {pending}
            </div>
          )}
          {streamingDraft && (
            <div className="self-start w-full flex flex-col gap-1">
              <ThinkingPanel thinking={streamingDraft.thinking} isStreaming={true} />
              <ThoughtStream
                ownerId={streamingDraft.id}
                activities={streamingDraft.activities || []}
                openThoughtIds={openThoughtIds}
                onToggleThought={toggleThought}
                getThoughtKey={thoughtKey}
                getThoughtElementId={thoughtElementId}
              />
              <div className="text-[16px] leading-relaxed">
                {streamingDraft.response
                  ? renderMd(streamingDraft.response)
                  : streamingDraft.thinking?.text
                    ? null
                    : <ThinkingDots />}
              </div>
            </div>
          )}
          {thinking && !streamingDraft && (
            <div className="self-start text-[16px] text-muted-foreground">
              <ThinkingDots />
            </div>
          )}
          <div ref={endRef} />
            </div>
            {!inlineEditId && (
              <div className="sticky bottom-0 z-10 mt-auto bg-background px-6 pb-5 pt-8">
                <div className="mx-auto w-full max-w-[760px]">{composer}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {(branchFromId || editId || newFromRef || (mm && sel.length > 0) || undoAction) && (
        <div className="mx-auto w-full max-w-[760px] px-6">
          {branchFromId && (
            <ModeBanner
              label="Branch from selected point"
              tone="user"
              onCancel={() => { setBranchFromId(null); setInput(""); }}
            />
          )}
          {editId && !inlineEditId && (
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
              <span className="text-base font-medium text-[color:var(--branch-1)]">{undoAction.label}</span>
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
          <div className="mb-2 text-base font-medium text-merge-foreground">
            You've reached the free message limit. Enter your API key to continue, or leave your email for updates.
          </div>
          {waitlistStatus === "done" ? (
            <div className="text-base font-medium text-[color:var(--branch-0)]">✓ You're on the list! We'll reach out soon.</div>
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
            <span className="text-base font-medium">{toast.message}</span>
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

  const graphNames = streamingDraft?.branch && !names.includes(streamingDraft.branch)
    ? [...names, streamingDraft.branch]
    : names;

  const graphArea = graph && (commits.length > 0 || streamingDraft) && (
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
          {graphActionsMenu}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setGraph(false)}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Cancel</TooltipContent>
          </Tooltip>
          <div className="mx-1 h-5 w-px bg-border" />
          {panelSwitcher}
        </div>
      </div>
      <Graph
        commits={commits}
        headId={headId}
        activeBranch={branch}
        names={graphNames}
        streamingDraft={streamingDraft}
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
          new Set([
            ...convs.flatMap((cv: any) => (cv.commits || []).flatMap((c: any) => c.tags || [])),
            ...(tagPool || []),
          ]),
        )}
        activeTags={activeTags}
        onRenameBranch={(b: string, newTitle: string) => renameBranch(convId, b, newTitle)}
        onDeleteBranch={(b: string) => requestDeleteBranch(b)}
        onSelectActivity={openThought}
      />
    </div>
  );

  const sourcesArea = sourcesOpen && visibleSources.length > 0 && (
    <div className="flex h-full flex-col overflow-hidden bg-graph-bg">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-base font-medium">Sources</span>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => { setSourcesOpen(false); setSourceCommitId(null); }}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Cancel</TooltipContent>
          </Tooltip>
          <div className="mx-1 h-5 w-px bg-border" />
          {panelSwitcher}
        </div>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {visibleSources.map((c: any, i: number) => (
          <SourceCard key={i} c={c} />
        ))}
      </div>
    </div>
  );

  const rightArea = sourcesArea || graphArea;
  const hasRightArea = Boolean(rightArea);

  useEffect(() => {
    if (!hasRightArea) {
      setPanelGroupWidth(0);
      return;
    }

    const el = panelGroupRef.current;
    if (!el) return;

    const updateWidth = () => setPanelGroupWidth(el.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasRightArea]);

  if (!rightArea) return chatArea;
  const rightPanelSizes = getRightPanelSizes(panelGroupWidth);

  return (
    <div ref={panelGroupRef} className="h-full w-full">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel minSize={100 - rightPanelSizes.maxSize}>
          {chatArea}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          defaultSize={rightPanelSizes.defaultSize}
          minSize={rightPanelSizes.minSize}
          maxSize={rightPanelSizes.maxSize}
        >
          {rightArea}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
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
      <span className="text-base font-medium">{label}</span>
      <Button size="sm" variant="outline" className="h-7" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const secs = Math.max(1, Math.round(ms / 1000));
  if (secs < 60) return secs + "s";
  const mins = Math.floor(secs / 60);
  const rest = secs % 60;
  return mins + "m" + (rest ? " " + rest + "s" : "");
}

function activityDisplayLabel(activity: any, now: number) {
  if (!activity) return "";
  if (activity.kind === "thinking" && activity.status === "running") {
    return "Thinking for " + formatDuration(now - activity.startedAt);
  }
  return activity.label;
}

function activityDetail(activity: any) {
  if (activity?.detail) return activity.detail;
  if (activity?.kind === "thinking") return "I spent a moment shaping the direction before writing.";
  if (activity?.kind === "searching") return "I checked whether sources were needed for this response.";
  if (activity?.kind === "writing") return "I started turning the plan into the visible answer.";
  if (activity?.kind === "source") return "I collected source information for the final answer.";
  if (activity?.kind === "done") return "The response is ready and saved into this conversation.";
  if (activity?.kind === "error") return "This step ran into a problem before finishing.";
  return "I used this step to organize the response.";
}

function RunningDots() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const interval = setInterval(() => setDots((d) => (d.length >= 3 ? "" : d + ".")), 400);
    return () => clearInterval(interval);
  }, []);
  return (
    <span aria-hidden className="inline-block w-[1ch] align-baseline">
      {dots}
    </span>
  );
}

function ThinkingPanel({ thinking, isStreaming }: { thinking?: any; isStreaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const live = isStreaming && !thinking?.finishedAt;
  const hasText = !!thinking?.text;

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);

  if (!hasText && !live) return null;

  const startedAt = thinking?.startedAt;
  const elapsedMs = thinking?.durationMs
    ?? (startedAt ? Math.max(0, now - startedAt) : 0);
  const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => hasText && setOpen((o) => !o)}
        disabled={!hasText}
        className={cn(
          "inline-flex items-center gap-1 text-[13px] italic text-muted-foreground/80",
          hasText && "hover:text-foreground/70 cursor-pointer",
          !hasText && "cursor-default",
        )}
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && hasText && "rotate-90")} />
        {live ? (
          <span>Thinking<RunningDots /></span>
        ) : (
          <span>Thought for {elapsedSec}s</span>
        )}
      </button>
      {open && hasText && (
        <div className="mt-1 ml-1.5 pl-3 border-l border-border/50 text-[13px] italic leading-relaxed text-muted-foreground/70 whitespace-pre-wrap">
          {thinking.text}
        </div>
      )}
    </div>
  );
}

function ThoughtStream({
  ownerId,
  activities,
  openThoughtIds,
  onToggleThought,
  getThoughtKey,
  getThoughtElementId,
}: {
  ownerId: string;
  activities: any[];
  openThoughtIds: Set<string>;
  onToggleThought: (ownerId: string, activityId: string) => void;
  getThoughtKey: (ownerId: string, activityId: string) => string;
  getThoughtElementId: (ownerId: string, activityId: string) => string;
}) {
  const [now, setNow] = useState(Date.now());
  const hasRunning = (activities || []).some((a) => a.status === "running" || a.status === "pending");

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  if (!activities?.length) return null;

  return (
    <div className="flex flex-col">
      {(activities || []).map((activity) => {
        const open = openThoughtIds.has(getThoughtKey(ownerId, activity.id));
        const isRunning = activity.status === "running" || activity.status === "pending";
        const isError = activity.status === "error";
        const detailText = activityDetail(activity);
        const expandable = !!detailText;
        const duration = activity.durationMs || (isRunning ? now - activity.startedAt : 0);
        return (
          <div key={activity.id} id={getThoughtElementId(ownerId, activity.id)} className="scroll-mt-24">
            <div
              role={expandable ? "button" : undefined}
              tabIndex={expandable ? 0 : undefined}
              onClick={expandable ? () => onToggleThought(ownerId, activity.id) : undefined}
              onKeyDown={
                expandable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggleThought(ownerId, activity.id);
                      }
                    }
                  : undefined
              }
              className={cn(
                "py-0.5 text-[13px] italic leading-snug select-none",
                isError ? "text-destructive" : "text-muted-foreground/80",
                expandable && "cursor-pointer hover:text-foreground/70",
                open && !isError && "text-foreground/80",
              )}
            >
              <span>{activityDisplayLabel(activity, now)}</span>
              {isRunning && <RunningDots />}
              {!isRunning && duration > 0 && (
                <span className="opacity-70"> · {formatDuration(duration)}</span>
              )}
            </div>
            {open && expandable && (
              <div className="pb-1 pl-3 text-[12px] italic leading-relaxed text-muted-foreground/70 whitespace-pre-wrap">
                {detailText}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SourceIconStack({ sources }: { sources: any[] }) {
  const hosts = Array.from(
    new Set(
      sources
        .map((s) => getHost(s.url))
        .filter(Boolean),
    ),
  ).slice(0, 2);

  if (!hosts.length) return <Link2 className="size-3.5" />;

  return (
    <span className="flex items-center -space-x-1">
      {hosts.map((host) => (
        <span
          key={host}
          className="flex size-4 items-center justify-center rounded-full border border-background bg-muted"
        >
          <Favicon host={host} className="size-3 rounded-full" />
        </span>
      ))}
    </span>
  );
}
