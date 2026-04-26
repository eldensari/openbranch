import { useState } from "react";
import { Folder, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { buildFolderTree, formatClusterTitle } from "@/storage/clusters";

export function flattenFolders(clusters: any[]): { folder: any; depth: number }[] {
  const userClusters = (clusters || []).filter((c: any) => c.auto !== true);
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusters: any[];
  convId: string | null;
  onMove: (convId: string, folderId: string | null) => void;
  onAfterMove?: (folderId: string | null) => void;
  title?: string;
  description?: string;
  excludeFolderId?: string | null;
};

export default function MoveToFolderDialog({ open, onOpenChange, clusters, convId, onMove, onAfterMove, title, description, excludeFolderId }: Props) {
  const [query, setQuery] = useState("");

  const flat = flattenFolders(clusters);
  const excludedSet = new Set<string>();
  if (excludeFolderId) {
    excludedSet.add(excludeFolderId);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of clusters) {
        if (!excludedSet.has(c.id) && c.parentId && excludedSet.has(c.parentId)) {
          excludedSet.add(c.id);
          grew = true;
        }
      }
    }
  }
  const visible = flat.filter(({ folder }) => !excludedSet.has(folder.id));
  const q = query.trim().toLowerCase();
  const matches = q
    ? visible.filter(({ folder }) => (folder.title || formatClusterTitle(folder.createdAt) || "").toLowerCase().includes(q))
    : visible;

  const choose = (folderId: string | null) => {
    if (!convId) return;
    onMove(convId, folderId);
    onAfterMove?.(folderId);
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setQuery(""); }}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? "Move chat"}</DialogTitle>
          <DialogDescription>{description ?? "Select a folder to move this chat into."}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search folders..."
            className="h-7 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          <button
            type="button"
            onClick={() => choose(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
          >
            <span className="italic text-muted-foreground">(top level)</span>
          </button>
          {matches.map(({ folder, depth }) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => choose(folder.id)}
              className="flex w-full items-center gap-2 rounded-md py-2 pr-2 text-left text-sm hover:bg-accent"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <Folder className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{folder.title || formatClusterTitle(folder.createdAt) || "Untitled"}</span>
            </button>
          ))}
          {matches.length === 0 && q && (
            <div className="py-6 text-center text-sm text-muted-foreground">No folders match "{query}"</div>
          )}
          {flat.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">No folders yet — create one from the sidebar.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
