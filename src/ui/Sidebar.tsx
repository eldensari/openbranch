import { useState } from "react";
import storage from "@/lib/storage";
import { detectProvider } from "@/lib/llm";
import { buildSidebarLayout } from "@/storage/sidebar";
import { buildFolderGroups, buildFolderTree, formatClusterTitle } from "@/storage/clusters";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, MoreHorizontal, PanelLeft, Pencil, Search, Settings, SquarePen, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RenameDialog from "./RenameDialog";
import MoveToFolderDialog from "./MoveToFolderDialog";

type TimeBucket = "today" | "yesterday" | "week" | "month" | "older";
const BUCKET_LABELS: Record<TimeBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 Days",
  month: "Previous 30 Days",
  older: "Older",
};
const BUCKET_ORDER: TimeBucket[] = ["today", "yesterday", "week", "month", "older"];

function timeBucketOf(ts?: string): TimeBucket {
  if (!ts) return "older";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "older";
  const startOfDay = (x: Date) => {
    const y = new Date(x);
    y.setHours(0, 0, 0, 0);
    return y.getTime();
  };
  const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "older";
}

type Props = any;

export default function AppSidebar(props: Props) {
  const {
    convs, clusters,
    convId,
    activeTags, setActiveTags, renameTag, deleteTag,
    renamingId, setRenamingId,
    renamingClusterId, setRenamingClusterId,
    renameVal, setRenameVal,
    expandedClusters, toggleCluster, expandFolder,
    activeFolderId, setActiveFolderId,
    createFolder, renameFolder, deleteFolder, moveConvToFolder, moveFolder,
    apiKey, setApiKey, showKeyInput, setShowKeyInput, keyDraft, setKeyDraft, hasKey, setRateLimited,
    newConv, loadMain,
    renameConv, del, countChildConvs,
    setConfirmDialog,
    collapsed,
    toggleSidebar,
  } = props;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(true);
  const [movingConvId, setMovingConvId] = useState<string | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);
  const q = searchQuery.trim().toLowerCase();

  const openSearch = () => {
    setSearchQuery("");
    setSearchOpen(true);
  };

  const dialogConvs = convs.filter((cv: any) => {
    if (!q) return true;
    if ((cv.title || "").toLowerCase().includes(q)) return true;
    return (cv.commits || []).some(
      (c: any) =>
        (c.prompt || "").toLowerCase().includes(q) ||
        (c.response || "").toLowerCase().includes(q),
    );
  });
  const dialogGroups: Record<TimeBucket, any[]> = {
    today: [], yesterday: [], week: [], month: [], older: [],
  };
  dialogConvs.forEach((cv: any) => {
    dialogGroups[timeBucketOf(cv.u || cv.createdAt)].push(cv);
  });
  BUCKET_ORDER.forEach((b) =>
    dialogGroups[b].sort((a: any, b: any) => (b.u || "").localeCompare(a.u || "")),
  );

  const searchDialog = (
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats..."
            className="h-8 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {BUCKET_ORDER.map((bucket) => {
            const items = dialogGroups[bucket];
            if (!items.length) return null;
            return (
              <div key={bucket} className="mt-1">
                <div className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {BUCKET_LABELS[bucket]}
                </div>
                {items.map((cv: any) => (
                  <button
                    key={cv.id}
                    type="button"
                    onClick={() => {
                      loadMain(cv);
                      setSearchOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate">{cv.title || "Untitled"}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {dialogConvs.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No chats found
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  const saveApiKey = () => {
    setApiKey(keyDraft.trim());
    storage.set("apiKey", keyDraft.trim());
    setShowKeyInput(false);
    setRateLimited(false);
  };

  const settingsDialog = (
    <Dialog open={showKeyInput} onOpenChange={setShowKeyInput}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">API Key</label>
            <Input
              autoFocus
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-ant-... or sk-... or AI..."
              className="font-mono text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveApiKey();
                if (e.key === "Escape") setShowKeyInput(false);
              }}
            />
            {keyDraft.trim() && detectProvider(keyDraft) && (
              <div className="text-xs font-medium" style={{ color: detectProvider(keyDraft).color }}>
                ✓ {detectProvider(keyDraft).name}
              </div>
            )}
            {keyDraft.trim() && !detectProvider(keyDraft) && (
              <div className="text-xs text-destructive">✗ Unknown format</div>
            )}
            {!keyDraft.trim() && (
              <div className="text-xs text-muted-foreground">
                Using free tier (10 requests/day). Add your key for higher limits.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowKeyInput(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveApiKey}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  const renamingConv = renamingId ? convs.find((c: any) => c.id === renamingId) : null;
  const renamingFolder = renamingClusterId ? clusters.find((c: any) => c.id === renamingClusterId) : null;
  const convDialogs = (
    <>
      <RenameDialog
        open={!!renamingConv}
        onOpenChange={(o) => { if (!o) setRenamingId(null); }}
        title="Rename chat"
        initialValue={renameVal}
        onSave={(v) => { if (renamingConv) renameConv(renamingConv.id, v); setRenamingId(null); }}
      />
      <RenameDialog
        open={!!renamingFolder}
        onOpenChange={(o) => { if (!o) setRenamingClusterId(null); }}
        title="Rename folder"
        initialValue={renameVal}
        onSave={(v) => { if (renamingFolder) renameFolder(renamingFolder.id, v); setRenamingClusterId(null); }}
      />
      <MoveToFolderDialog
        open={!!movingConvId}
        onOpenChange={(o) => { if (!o) setMovingConvId(null); }}
        clusters={clusters}
        convId={movingConvId}
        onMove={moveConvToFolder}
        onAfterMove={(fid) => { if (fid) expandFolder(fid); }}
      />
      <MoveToFolderDialog
        open={!!movingFolderId}
        onOpenChange={(o) => { if (!o) setMovingFolderId(null); }}
        clusters={clusters}
        convId={movingFolderId}
        onMove={(fid, parentId) => moveFolder(fid, parentId)}
        onAfterMove={(parentId) => { if (parentId) expandFolder(parentId); }}
        title="Move folder"
        description="Select a parent folder."
        excludeFolderId={movingFolderId}
      />
    </>
  );

  if (collapsed) {
    return (
      <>
        <div className="group/rail flex h-full flex-col items-start gap-1 p-2">
          <div className="relative size-9">
            <Button
              variant="ghost"
              size="icon"
              className="absolute inset-0 size-9 transition-opacity group-hover/rail:pointer-events-none group-hover/rail:opacity-0"
              onClick={toggleSidebar}
              title="Expand sidebar"
            >
              <img src="/favicon.svg" alt="OpenBranch" className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="pointer-events-none absolute inset-0 size-9 opacity-0 transition-opacity group-hover/rail:pointer-events-auto group-hover/rail:opacity-100"
              onClick={toggleSidebar}
              title="Expand sidebar"
            >
              <PanelLeft className="size-4" />
            </Button>
          </div>
          <div className="h-2" />
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={newConv}
            title="New chat"
          >
            <SquarePen className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={openSearch}
            title="Search chats"
          >
            <Search className="size-4" />
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => { setKeyDraft(apiKey); setShowKeyInput(true); }}
            title="Settings"
          >
            <Settings className="size-4" />
          </Button>
        </div>
        {searchDialog}
        {settingsDialog}
        {convDialogs}
      </>
    );
  }

  const renderConvItem = (cv: any, keyPrefix: string, depth = 0) => {
    const convActive = convId === cv.id;

    return (
      <div key={keyPrefix + ":" + cv.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onClick={() => loadMain(cv)}
              className={cn(
                "group flex cursor-pointer items-center rounded-md py-1.5 pr-1.5 text-sm transition-colors",
                convActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent",
              )}
              style={{ paddingLeft: 8 + depth * 14 + (depth > 0 ? 18 : 0) }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate" title={cv.title || "Untitled"}>
                  {cv.title || "Untitled"}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="More actions"
                    className="ml-1 flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-sidebar-accent/80 hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" className="min-w-[14rem] rounded-2xl p-1" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem
                    onSelect={() => {
                      setRenameVal(cv.title || "");
                      setRenamingId(cv.id);
                      setRenamingClusterId(null);
                    }}
                    className="gap-3 py-2"
                  >
                    <Pencil className="size-4" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setMovingConvId(cv.id)} className="gap-3 py-2">
                    <Folder className="size-4" />
                    Move to folder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      const n = countChildConvs(cv.id);
                      const msg = n > 0 ? `Delete this conversation and ${n} descendant conversation${n > 1 ? "s" : ""}?` : "Delete this conversation?";
                      setConfirmDialog({ msg, onConfirm: () => del(cv.id) });
                    }}
                    className="gap-3 py-2"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-[14rem] rounded-2xl p-1">
            <ContextMenuItem
              onSelect={() => {
                setRenameVal(cv.title || "");
                setRenamingId(cv.id);
                setRenamingClusterId(null);
              }}
              className="gap-3 py-2"
            >
              <Pencil className="size-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setMovingConvId(cv.id)} className="gap-3 py-2">
              <Folder className="size-4" />
              Move to folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => {
                const n = countChildConvs(cv.id);
                const msg = n > 0 ? `Delete this conversation and ${n} descendant conversation${n > 1 ? "s" : ""}?` : "Delete this conversation?";
                setConfirmDialog({ msg, onConfirm: () => del(cv.id) });
              }}
              className="gap-3 py-2"
            >
              <Trash2 className="size-4" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  };

  const tagCounts: Record<string, number> = {};
  convs.forEach((cv: any) =>
    (cv.commits || []).forEach((c: any) => (c.tags || []).forEach((tg: string) => {
      tagCounts[tg] = (tagCounts[tg] || 0) + 1;
    })),
  );
  const tagEntries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);

  const liveTags = new Set<string>();
  convs.forEach((cv: any) => (cv.commits || []).forEach((c: any) => (c.tags || []).forEach((tg: string) => liveTags.add(tg))));
  const liveActive = new Set<string>([...(activeTags as Set<string>)].filter((tg: string) => liveTags.has(tg)));
  const convHasAnyTag = (cv: any) => (cv.commits || []).some((c: any) => (c.tags || []).some((tg: string) => liveActive.has(tg)));
  const filteredConvs = liveActive.size ? convs.filter(convHasAnyTag) : convs;
  const { topLevelConvs, rootFolders: folderGroupsAll } = buildFolderGroups(filteredConvs, clusters);
  const pruneEmpty = (group: any): any => {
    const prunedChildren = group.children.map(pruneEmpty).filter(Boolean);
    if (group.items.length === 0 && prunedChildren.length === 0) return null;
    return { ...group, children: prunedChildren };
  };
  const folderGroups = liveActive.size ? folderGroupsAll.map(pruneEmpty).filter(Boolean) : folderGroupsAll;
  const { rootItems: topRootItems } = buildSidebarLayout(topLevelConvs);
  const userClusters = clusters.filter((c: any) => c.auto !== true);

  function flattenFolders() {
    const { rootFolders, childrenByParentId } = buildFolderTree(userClusters);
    const out: { folder: any; depth: number }[] = [];
    const walk = (arr: any[], depth: number) => {
      for (const f of arr) {
        out.push({ folder: f, depth });
        walk(childrenByParentId.get(f.id) || [], depth + 1);
      }
    };
    walk(rootFolders, 0);
    return out;
  }

  const renderFolder = (group: any, depth: number) => {
    const folder = group.folder;
    const folderId = folder.id;
    const isCollapsed = !expandedClusters.has(folderId);
    const hasContent = group.items.length > 0 || group.children.length > 0;
    const { rootItems } = buildSidebarLayout(group.items);
    const folderActions = {
      newChat: () => {
        setActiveFolderId(folderId);
        expandFolder(folderId);
        newConv();
      },
      newFolder: () => {
        expandFolder(folderId);
        const f = createFolder(folderId);
        setRenameVal("Untitled");
        setRenamingClusterId(f.id);
        setRenamingId(null);
      },
      rename: () => {
        setRenameVal(folder.title || "");
        setRenamingClusterId(folderId);
        setRenamingId(null);
      },
      delete: () => {
        const folderTitle = folder.title || "this folder";
        const set = new Set<string>([folderId]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const c of clusters) {
            if (!set.has(c.id) && c.parentId && set.has(c.parentId)) { set.add(c.id); grew = true; }
          }
        }
        const affected = convs.filter((cv: any) => set.has(cv.clusterId));
        const n = affected.length;
        const msg = n > 0
          ? `Delete folder "${folderTitle}"?\n\n${n} conversation${n > 1 ? "s" : ""} will move up to the parent folder. Subfolders stay; only the folder itself is removed.`
          : `Delete folder "${folderTitle}"?`;
        setConfirmDialog({ msg, onConfirm: () => deleteFolder(folderId) });
      },
    };
    return (
      <div key={folderId}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onClick={() => {
                setActiveFolderId(folderId);
                if (hasContent) toggleCluster(folderId);
              }}
              className="group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-1 text-sm font-semibold transition-colors hover:bg-sidebar-accent"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {isCollapsed ? <Folder className="size-4 shrink-0" /> : <FolderOpen className="size-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="truncate" title={folder.title || "Untitled"}>
                  {folder.title || formatClusterTitle(folder.createdAt) || "Untitled"}
                </div>
              </div>
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="More actions"
                      className="ml-1 flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-sidebar-accent/80 hover:text-foreground focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="bottom" className="min-w-[14rem] rounded-2xl p-1" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={folderActions.rename} className="gap-3 py-2">
                      <Pencil className="size-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMovingFolderId(folderId)} className="gap-3 py-2">
                      <Folder className="size-4" />
                      Move to folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={folderActions.delete} className="gap-3 py-2">
                      <Trash2 className="size-4" />
                      Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-[14rem] rounded-2xl p-1">
            <ContextMenuItem
              onSelect={() => {
                setRenameVal(folder.title || "");
                setRenamingClusterId(folderId);
                setRenamingId(null);
              }}
              className="gap-3 py-2"
            >
              <Pencil className="size-4" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => setMovingFolderId(folderId)}
              className="gap-3 py-2"
            >
              <Folder className="size-4" />
              Move to folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => {
                const folderTitle = folder.title || "this folder";
                const affected: any[] = [];
                const set = new Set([folderId]);
                let grew = true;
                while (grew) {
                  grew = false;
                  for (const c of clusters) {
                    if (!set.has(c.id) && c.parentId && set.has(c.parentId)) { set.add(c.id); grew = true; }
                  }
                }
                for (const cv of convs) if (set.has(cv.clusterId)) affected.push(cv);
                const n = affected.length;
                const msg = n > 0
                  ? `Delete folder "${folderTitle}"?\n\n${n} conversation${n > 1 ? "s" : ""} will move up to the parent folder. Subfolders stay; only the folder itself is removed.`
                  : `Delete folder "${folderTitle}"?`;
                setConfirmDialog({ msg, onConfirm: () => deleteFolder(folderId) });
              }}
              className="gap-3 py-2"
            >
              <Trash2 className="size-4" />
              Delete folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {!isCollapsed && (
          <>
            {rootItems.map((item: any) => renderConvItem(item.conv, "fd:" + folderId, depth + 1))}
            {group.children.map((child: any) => renderFolder(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <SidebarHeader className="gap-1 px-2 pt-0 pb-2">
        <div className="flex h-12 items-center justify-between">
          <div className="flex items-center gap-2 px-2">
            <img src="/favicon.svg" alt="" className="size-5" />
            <span className="text-base font-semibold">OpenBranch</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={toggleSidebar}
            title="Collapse sidebar"
          >
            <PanelLeft className="size-4" />
          </Button>
        </div>
        <div className="h-1" />
        <Button
          variant="ghost"
          onClick={newConv}
          className="h-9 w-full justify-start gap-2 px-2.5 font-normal hover:bg-sidebar-accent"
        >
          <SquarePen className="size-4" />
          New chat
        </Button>
        <Button
          variant="ghost"
          onClick={openSearch}
          className="h-9 w-full justify-start gap-2 px-2.5 font-normal hover:bg-sidebar-accent"
        >
          <Search className="size-4" />
          Search chats
        </Button>
      </SidebarHeader>

      <SidebarContent>
        {!collapsed && tagEntries.length > 0 && (
          <SidebarGroup>
            <button
              type="button"
              onClick={() => setTagsOpen((v) => !v)}
              className="group/tag-head flex h-8 w-fit shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              Tags
              <span className="opacity-0 transition-opacity group-hover/tag-head:opacity-100">
                {tagsOpen ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </span>
            </button>
            {tagsOpen && (
              <div className="flex flex-col gap-0.5 px-1 pb-1">
                {tagEntries.map(([tg, n]) => {
                  const on = activeTags.has(tg);
                  return (
                    <ContextMenu key={tg}>
                      <ContextMenuTrigger asChild>
                        <span
                          onClick={() =>
                            setActiveTags((p: Set<string>) => {
                              const s = new Set(p);
                              s.has(tg) ? s.delete(tg) : s.add(tg);
                              return s;
                            })
                          }
                          className={cn(
                            "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors select-none",
                            on
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "hover:bg-sidebar-accent",
                          )}
                        >
                          <span className="shrink-0 text-muted-foreground">#</span>
                          <span className="flex-1 truncate">{tg}</span>
                          <span className="text-xs text-muted-foreground">{n}</span>
                        </span>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="min-w-[14rem] rounded-2xl p-1">
                        <ContextMenuItem
                          onSelect={() => {
                            const nv = window.prompt("Rename tag", tg);
                            if (nv != null) renameTag(tg, nv);
                          }}
                          className="gap-3 py-2"
                        >
                          <Pencil className="size-4" />
                          Rename
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() =>
                            setConfirmDialog({
                              msg: `Remove tag "${tg}" from all commits?`,
                              onConfirm: () => deleteTag(tg),
                            })
                          }
                          className="gap-3 py-2"
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              </div>
            )}
          </SidebarGroup>
        )}

        {!collapsed && (
          <SidebarGroup>
            <button
              type="button"
              onClick={() => setChatsOpen((v) => !v)}
              className="group/chat-head flex h-8 w-fit shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              Chats
              <span className="opacity-0 transition-opacity group-hover/chat-head:opacity-100">
                {chatsOpen ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </span>
            </button>
            {chatsOpen && (
              <button
                type="button"
                onClick={() => {
                  const f = createFolder(null);
                  setRenameVal("Untitled");
                  setRenamingClusterId(f.id);
                  setRenamingId(null);
                }}
                className="mx-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-normal text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <FolderPlus className="size-4 shrink-0" />
                New folder
              </button>
            )}
            {chatsOpen && (
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="flex flex-col px-1">
                    {topRootItems.map((item: any) => renderConvItem(item.conv, "top", 0))}
                    {folderGroups.map((group: any) => renderFolder(group, 0))}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[14rem] rounded-2xl p-1">
                  <ContextMenuItem
                    onSelect={() => {
                      const f = createFolder(null);
                      setRenameVal("Untitled");
                      setRenamingClusterId(f.id);
                      setRenamingId(null);
                    }}
                    className="gap-3 py-2"
                  >
                    <FolderPlus className="size-4" />
                    New folder
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3">
        <Button
          variant="ghost"
          onClick={() => { setKeyDraft(apiKey); setShowKeyInput(true); }}
          className="h-10 w-full justify-start gap-3 px-3 font-normal hover:bg-sidebar-accent"
        >
          <Settings className="size-4" />
          Settings
        </Button>
      </SidebarFooter>
      {searchDialog}
      {settingsDialog}
      {convDialogs}
    </>
  );
}
