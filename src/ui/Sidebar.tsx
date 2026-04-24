import { useState } from "react";
import storage from "@/lib/storage";
import { detectProvider } from "@/lib/llm";
import { getBranchLabel, buildBranchTree, getBranchDescendantNames } from "@/graph/branches";
import { sidebarBranchKey, buildSidebarLayout } from "@/storage/sidebar";
import { buildFolderGroups, buildFolderTree, formatClusterTitle } from "@/storage/clusters";
import { ChevronDown, ChevronRight, Folder, FolderOpen, KeyRound, MoreHorizontal, Menu, Search, SquarePen } from "lucide-react";
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
import { Dialog, DialogContent } from "@/components/ui/dialog";

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
    convId, branch,
    activeTags, setActiveTags, renameTag, deleteTag,
    renamingId, setRenamingId,
    renamingBranch, setRenamingBranch,
    renamingClusterId, setRenamingClusterId,
    renameVal, setRenameVal,
    expandedClusters, toggleCluster, expandFolder,
    sidebarItemOpen, toggleSidebarItem,
    activeFolderId, setActiveFolderId,
    createFolder, renameFolder, deleteFolder, moveConvToFolder,
    apiKey, setApiKey, showKeyInput, setShowKeyInput, keyDraft, setKeyDraft, hasKey, setRateLimited,
    newConv, loadMain, loadBranch,
    renameConv, renameBranch, del, countChildConvs, deleteBranchCascade,
    setConfirmDialog,
    collapsed,
    toggleSidebar,
  } = props;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(true);
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

  if (collapsed) {
    return (
      <>
        <div className="flex h-full flex-col items-start gap-1 p-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={toggleSidebar}
            title="Expand sidebar"
          >
            <Menu className="size-4" />
          </Button>
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
        </div>
        {searchDialog}
      </>
    );
  }

  const goToChildRef = (childCv: any) => {
    if (childCv.clusterId) {
      setActiveFolderId(childCv.clusterId);
      expandFolder(childCv.clusterId);
    }
    loadMain(childCv);
  };

  const renderConvItem = (cv: any, keyPrefix: string, depth = 0, toggle: any = null, childRefs = new Map()) => {
    const chain = cv.commits || [];
    const branchTree = buildBranchTree(chain);
    const convActive = convId === cv.id;
    const convActiveOnMain = convActive && branch === "main";
    const renamingThisConv = renamingId === cv.id;
    const branchesByParent: Record<string, any[]> = {};
    branchTree.forEach((b: any) => {
      const parent = b.parentBranch || "main";
      (branchesByParent[parent] || (branchesByParent[parent] = [])).push(b);
    });
    const rootBranches = branchesByParent["main"] || [];
    const myChildren = childRefs.get(cv.id) || [];
    const isNewChild = (c: any) => !c.parentRef?.anchorBranch || c.parentRef.anchorBranch === "main";
    const branchGhosts = myChildren.filter((c: any) => !isNewChild(c));
    const newGhosts = myChildren.filter(isNewChild);
    const hasChildren = rootBranches.length > 0 || myChildren.length > 0;
    const ownToggleKey = cv.id + ":conv";
    const localToggle = !toggle && hasChildren
      ? { open: sidebarItemOpen(ownToggleKey), onToggle: () => toggleSidebarItem(ownToggleKey) }
      : null;
    const activeToggle = toggle || localToggle;
    const hasToggle = !!activeToggle;
    const showBranches = !hasToggle || activeToggle.open;
    const branchKey = (bName: string) => sidebarBranchKey(cv.id, bName);
    const branchOpen = (bName: string) => sidebarItemOpen(branchKey(bName));
    const branchSubtreeContainsActive = (bName: string): boolean => {
      if (!convActive) return false;
      if (bName === branch) return true;
      const kids = branchesByParent[bName] || [];
      return kids.some((k: any) => branchSubtreeContainsActive(k.branch));
    };

    const renderBranchNode = ({ branch: bName, depth: bDepth }: any) => {
      const branchActive = convActive && branch === bName;
      const renamingThisBranch = renamingBranch && renamingBranch.convId === cv.id && renamingBranch.branch === bName;
      const displayLabel = getBranchLabel(chain, bName, cv.branchTitles);
      const childBranches = branchesByParent[bName] || [];
      const hasBranchChildren = childBranches.length > 0;
      const isBranchOpen = branchOpen(bName) || branchSubtreeContainsActive(bName);
      return (
        <div key={keyPrefix + ":" + cv.id + ":" + bName}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                onClick={() => {
                  if (!renamingThisBranch) {
                    if (hasBranchChildren && !isBranchOpen) toggleSidebarItem(branchKey(bName));
                    loadBranch(cv, bName);
                  }
                }}
                className={cn(
                  "group flex cursor-pointer items-center rounded-md py-1.5 pr-1.5 text-sm italic transition-colors",
                  branchActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground opacity-100"
                    : "text-sidebar-foreground/70 opacity-80 hover:bg-sidebar-accent/60 hover:opacity-100",
                )}
                style={{ paddingLeft: 8 + (depth + bDepth) * 14 + (depth > 0 ? 18 : 0) }}
              >
                <div className="min-w-0 flex-1">
                  {renamingThisBranch ? (
                    <Input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { renameBranch(cv.id, bName, renameVal); setRenamingBranch(null); }
                        if (e.key === "Escape") setRenamingBranch(null);
                      }}
                      onBlur={() => { renameBranch(cv.id, bName, renameVal); setRenamingBranch(null); }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-6 px-1.5 text-sm"
                    />
                  ) : (
                    <div className={cn("truncate", hasBranchChildren && isBranchOpen && "font-semibold")} title={displayLabel}>
                      {displayLabel}
                    </div>
                  )}
                </div>
                {!renamingThisBranch && (
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
                    <DropdownMenuContent align="end" side="bottom" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenameVal(displayLabel);
                          setRenamingBranch({ convId: cv.id, branch: bName });
                          setRenamingId(null);
                          setRenamingClusterId(null);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          const descs = getBranchDescendantNames(cv.commits || [], bName);
                          const msg = descs.length > 0
                            ? `Delete branch "${bName}"? This will also delete ${descs.length} child branch${descs.length > 1 ? "es" : ""}.`
                            : `Delete branch "${bName}"?`;
                          setConfirmDialog({ msg, onConfirm: () => deleteBranchCascade(cv.id, bName) });
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  setRenameVal(displayLabel);
                  setRenamingBranch({ convId: cv.id, branch: bName });
                  setRenamingId(null);
                  setRenamingClusterId(null);
                }}
              >
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => {
                  const descs = getBranchDescendantNames(cv.commits || [], bName);
                  const msg = descs.length > 0
                    ? `Delete branch "${bName}"? This will also delete ${descs.length} child branch${descs.length > 1 ? "es" : ""}.`
                    : `Delete branch "${bName}"?`;
                  setConfirmDialog({ msg, onConfirm: () => deleteBranchCascade(cv.id, bName) });
                }}
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {hasBranchChildren && isBranchOpen && childBranches.map(renderBranchNode)}
        </div>
      );
    };

    return (
      <div key={keyPrefix + ":" + cv.id}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onClick={() => {
                if (!renamingThisConv) {
                  if (hasToggle) activeToggle.onToggle();
                  loadMain(cv);
                }
              }}
              className={cn(
                "group flex cursor-pointer items-center rounded-md py-1.5 pr-1.5 text-sm transition-colors",
                convActiveOnMain
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : hasToggle && activeToggle.open
                  ? "bg-sidebar-accent/50"
                  : "hover:bg-sidebar-accent/60",
              )}
              style={{ paddingLeft: 8 + depth * 14 + (depth > 0 ? 18 : 0) }}
            >
              <div className="min-w-0 flex-1">
                {renamingThisConv ? (
                  <Input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { renameConv(cv.id, renameVal); setRenamingId(null); }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => { renameConv(cv.id, renameVal); setRenamingId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 px-1.5 text-sm"
                  />
                ) : (
                  <div className={cn("truncate", hasToggle && activeToggle.open && "font-semibold")} title={cv.title || "Untitled"}>
                    {cv.title || "Untitled"}
                  </div>
                )}
              </div>
              {!renamingThisConv && (
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
                  <DropdownMenuContent align="end" side="bottom" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem
                      onSelect={() => {
                        setRenameVal(cv.title || "");
                        setRenamingId(cv.id);
                        setRenamingBranch(null);
                        setRenamingClusterId(null);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onSelect={() => moveConvToFolder(cv.id, null)}>
                          <span className="italic text-muted-foreground">(top level)</span>
                        </DropdownMenuItem>
                        {flattenFolders().map(({ folder, depth: fd }) => (
                          <DropdownMenuItem
                            key={folder.id}
                            onSelect={() => { moveConvToFolder(cv.id, folder.id); expandFolder(folder.id); }}
                            style={{ paddingLeft: 8 + fd * 10 }}
                          >
                            {folder.title || formatClusterTitle(folder.createdAt) || "Untitled"}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        const n = countChildConvs(cv.id);
                        const msg = n > 0 ? `Delete this conversation and ${n} descendant conversation${n > 1 ? "s" : ""}?` : "Delete this conversation?";
                        setConfirmDialog({ msg, onConfirm: () => del(cv.id) });
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => {
                setRenameVal(cv.title || "");
                setRenamingId(cv.id);
                setRenamingBranch(null);
                setRenamingClusterId(null);
              }}
            >
              Rename
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Move to folder</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => moveConvToFolder(cv.id, null)}>
                  <span className="italic text-muted-foreground">(top level)</span>
                </ContextMenuItem>
                {flattenFolders().map(({ folder, depth }) => (
                  <ContextMenuItem
                    key={folder.id}
                    onSelect={() => { moveConvToFolder(cv.id, folder.id); expandFolder(folder.id); }}
                    style={{ paddingLeft: 8 + depth * 10 }}
                  >
                    <Folder className="size-3.5" /> {folder.title || formatClusterTitle(folder.createdAt) || "Untitled"}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => {
                const n = countChildConvs(cv.id);
                const msg = n > 0 ? `Delete this conversation and ${n} descendant conversation${n > 1 ? "s" : ""}?` : "Delete this conversation?";
                setConfirmDialog({ msg, onConfirm: () => del(cv.id) });
              }}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {showBranches && rootBranches.map(renderBranchNode)}
        {showBranches && branchGhosts.map((child: any) => (
          <div
            key={keyPrefix + ":" + cv.id + ":bref:" + child.id}
            onClick={(e) => { e.stopPropagation(); goToChildRef(child); }}
            title={child.title || "Untitled"}
            className="flex cursor-pointer items-center rounded-md py-1.5 pr-1.5 text-sm italic text-sidebar-foreground/60 opacity-70 hover:bg-sidebar-accent/50 hover:opacity-100"
            style={{ paddingLeft: 8 + depth * 14 + (depth > 0 ? 18 : 0) }}
          >
            <div className="min-w-0 flex-1 truncate">{child.title || "Untitled"}</div>
          </div>
        ))}
        {showBranches && newGhosts.map((child: any) => (
          <div
            key={keyPrefix + ":" + cv.id + ":nref:" + child.id}
            onClick={(e) => { e.stopPropagation(); goToChildRef(child); }}
            title={child.title || "Untitled"}
            className="flex cursor-pointer items-center rounded-md py-1.5 pr-1.5 text-sm italic text-sidebar-foreground/60 opacity-70 hover:bg-sidebar-accent/50 hover:opacity-100"
            style={{ paddingLeft: 8 + depth * 14 + (depth > 0 ? 18 : 0) }}
          >
            <div className="min-w-0 flex-1 truncate">{child.title || "Untitled"}</div>
          </div>
        ))}
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
  const { rootItems: topRootItems, childRefs: topChildRefs } = buildSidebarLayout(topLevelConvs);
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
    const isRenaming = renamingClusterId === folderId;
    const hasContent = group.items.length > 0 || group.children.length > 0;
    const { rootItems, childRefs } = buildSidebarLayout(group.items);
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
        setRenamingBranch(null);
      },
      rename: () => {
        setRenameVal(folder.title || "");
        setRenamingClusterId(folderId);
        setRenamingId(null);
        setRenamingBranch(null);
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
                if (!isRenaming) {
                  setActiveFolderId(folderId);
                  if (hasContent) toggleCluster(folderId);
                }
              }}
              className="group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-1 text-sm font-semibold transition-colors hover:bg-sidebar-accent/60"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {isCollapsed ? <Folder className="size-4 shrink-0" /> : <FolderOpen className="size-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <Input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { renameFolder(folderId, renameVal); setRenamingClusterId(null); }
                      if (e.key === "Escape") setRenamingClusterId(null);
                    }}
                    onBlur={() => { renameFolder(folderId, renameVal); setRenamingClusterId(null); }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-6 px-1.5 text-sm"
                  />
                ) : (
                  <div className="truncate" title={folder.title || "Untitled"}>
                    {folder.title || formatClusterTitle(folder.createdAt) || "Untitled"}
                  </div>
                )}
              </div>
              {!isRenaming && (
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
                  <DropdownMenuContent align="end" side="bottom" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={folderActions.newChat}>
                      New chat
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={folderActions.newFolder}>
                      New folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={folderActions.rename}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={folderActions.delete}>
                      Delete folder
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => {
                setActiveFolderId(folderId);
                expandFolder(folderId);
                newConv();
              }}
            >
              New chat
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => {
                expandFolder(folderId);
                const f = createFolder(folderId);
                setRenameVal("Untitled");
                setRenamingClusterId(f.id);
                setRenamingId(null);
                setRenamingBranch(null);
              }}
            >
              New folder
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() => {
                setRenameVal(folder.title || "");
                setRenamingClusterId(folderId);
                setRenamingId(null);
                setRenamingBranch(null);
              }}
            >
              Rename
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
            >
              Delete folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {!isCollapsed && (
          <>
            {rootItems.map((item: any) => renderConvItem(item.conv, "fd:" + folderId, depth + 1, null, childRefs))}
            {group.children.map((child: any) => renderFolder(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <SidebarHeader className="gap-1 p-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9"
          onClick={toggleSidebar}
          title="Collapse sidebar"
        >
          <Menu className="size-4" />
        </Button>
        <div className="h-2" />
        <Button
          variant="ghost"
          onClick={newConv}
          className="h-9 w-full justify-start gap-2 px-2 font-normal hover:bg-sidebar-accent/60"
        >
          <SquarePen className="size-4" />
          New chat
        </Button>
        <Button
          variant="ghost"
          onClick={openSearch}
          className="h-9 w-full justify-start gap-2 px-2 font-normal hover:bg-sidebar-accent/60"
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
              className="group/tag-head flex h-8 w-fit shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
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
                            "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors select-none",
                            on
                              ? "bg-sidebar-accent text-sidebar-accent-foreground"
                              : "hover:bg-sidebar-accent/60",
                          )}
                        >
                          <span className="shrink-0 text-muted-foreground">#</span>
                          <span className="flex-1 truncate">{tg}</span>
                          <span className="text-[10px] text-muted-foreground">{n}</span>
                        </span>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() => {
                            const nv = window.prompt("Rename tag", tg);
                            if (nv != null) renameTag(tg, nv);
                          }}
                        >
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
                        >
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
              className="group/chat-head flex h-8 w-fit shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground"
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
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="flex flex-col px-1">
                    {topRootItems.map((item: any) => renderConvItem(item.conv, "top", 0, null, topChildRefs))}
                    {folderGroups.map((group: any) => renderFolder(group, 0))}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      const f = createFolder(null);
                      setRenameVal("Untitled");
                      setRenamingClusterId(f.id);
                      setRenamingId(null);
                      setRenamingBranch(null);
                    }}
                  >
                    New folder
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        {!collapsed && (
          <>
            {!showKeyInput ? (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full justify-start gap-2 text-sm",
                  hasKey ? "text-[color:var(--branch-0)]" : "text-muted-foreground",
                )}
                onClick={() => { setKeyDraft(apiKey); setShowKeyInput(true); }}
              >
                <KeyRound className="size-3.5" />
                {hasKey ? "Connected" : "API Key"}
                {hasKey && detectProvider(apiKey) && (
                  <span className="ml-auto text-[10px] font-medium" style={{ color: detectProvider(apiKey).color }}>
                    {detectProvider(apiKey).name}
                  </span>
                )}
              </Button>
            ) : (
              <div className="flex flex-col gap-1.5 px-1 py-1">
                <Input
                  autoFocus
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="sk-ant-... or sk-..."
                  className="h-8 font-mono text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setApiKey(keyDraft.trim());
                      storage.set("apiKey", keyDraft.trim());
                      setShowKeyInput(false);
                      setRateLimited(false);
                    }
                    if (e.key === "Escape") setShowKeyInput(false);
                  }}
                />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    onClick={() => {
                      setApiKey(keyDraft.trim());
                      storage.set("apiKey", keyDraft.trim());
                      setShowKeyInput(false);
                      setRateLimited(false);
                    }}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => setShowKeyInput(false)}>
                    Cancel
                  </Button>
                </div>
                {keyDraft.trim() && detectProvider(keyDraft) && (
                  <div className="text-[10px] font-medium" style={{ color: detectProvider(keyDraft).color }}>
                    ✓ {detectProvider(keyDraft).name}
                  </div>
                )}
                {keyDraft.trim() && !detectProvider(keyDraft) && (
                  <div className="text-[10px] text-destructive">✗ Unknown format</div>
                )}
              </div>
            )}
          </>
        )}
      </SidebarFooter>
      {searchDialog}
    </>
  );
}
