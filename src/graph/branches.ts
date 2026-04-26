import type { Commit } from "@/types";

type BranchTitles = Record<string, string> | undefined;

// Display label for a branch. Unified across sidebar + graph tabs.
export function getBranchLabel(
  commits: Commit[],
  branchName: string,
  branchTitles?: BranchTitles,
): string {
  const custom = branchTitles?.[branchName];
  if (custom) return custom;
  const firstOnBranch = (commits || [])
    .filter((c) => c.branch === branchName)
    .sort((a, b) => a.ts - b.ts)[0];
  const prompt = firstOnBranch?.prompt;
  if (!prompt) return branchName;
  return prompt.replace(/\s+/g, " ").trim();
}

type BranchNode = {
  branch: string;
  depth: number;
  parentBranch: string | null;
  hasChildren: boolean;
  label: string;
};

type BranchInfo = {
  name: string;
  firstCommit: Commit;
  parentBranch: string | null;
  children: string[];
};

export function buildBranchTree(commits: Commit[]): BranchNode[] {
  if (!commits.length) return [];
  const byBranch: Record<string, Commit[]> = {};
  for (const c of commits) (byBranch[c.branch] || (byBranch[c.branch] = [])).push(c);

  const info: Record<string, BranchInfo> = {};
  for (const [name, list] of Object.entries(byBranch)) {
    const first = list.reduce((a, b) => (a.ts < b.ts ? a : b));
    const parentCm = first.parentId ? commits.find((c) => c.id === first.parentId) : null;
    const parentBranch = parentCm && parentCm.branch !== name ? parentCm.branch : null;
    info[name] = { name, firstCommit: first, parentBranch, children: [] };
  }
  for (const b of Object.values(info)) {
    if (b.parentBranch && info[b.parentBranch]) info[b.parentBranch].children.push(b.name);
  }
  for (const b of Object.values(info)) {
    b.children.sort((x, y) => info[x].firstCommit.ts - info[y].firstCommit.ts);
  }

  const result: BranchNode[] = [];
  const visited = new Set<string>();
  const walk = (name: string, depth: number) => {
    if (visited.has(name)) return;
    visited.add(name);
    if (name !== "main") {
      const prompt = info[name].firstCommit?.prompt || name;
      result.push({
        branch: name,
        depth,
        parentBranch: info[name].parentBranch,
        hasChildren: info[name].children.length > 0,
        label: prompt.replace(/\s+/g, " ").trim(),
      });
    }
    for (const child of info[name].children) walk(child, depth + 1);
  };

  if (info["main"]) walk("main", 0);
  for (const b of Object.values(info)) if (!visited.has(b.name)) walk(b.name, 1);

  return result;
}

export function commitBranch(cv: { commits?: Commit[] }, commitId: string): string | null {
  return (cv.commits || []).find((c) => c.id === commitId)?.branch || null;
}

export function branchPathToRoot(commits: Commit[], branchName: string): string[] {
  if (!branchName || branchName === "main") return [];
  const branchTree = buildBranchTree(commits || []);
  const byName: Record<string, BranchNode> = {};
  branchTree.forEach((b) => {
    byName[b.branch] = b;
  });
  const path: string[] = [];
  let cur: string | null = branchName;
  while (cur && cur !== "main" && byName[cur]) {
    path.unshift(cur);
    cur = byName[cur].parentBranch;
  }
  return path;
}

export function getBranchDescendantNames(cms: Commit[], bName: string): string[] {
  if (!cms.length) return [];
  const byBranch: Record<string, Commit[]> = {};
  for (const c of cms) (byBranch[c.branch] || (byBranch[c.branch] = [])).push(c);
  const parentOf: Record<string, string | null> = {};
  for (const [name, list] of Object.entries(byBranch)) {
    const first = list.reduce((a, b) => (a.ts < b.ts ? a : b));
    const parentCm = first.parentId ? cms.find((c) => c.id === first.parentId) : null;
    parentOf[name] = parentCm && parentCm.branch !== name ? parentCm.branch : null;
  }
  const set = new Set<string>([bName]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of Object.keys(byBranch)) {
      if (!set.has(name) && parentOf[name] && set.has(parentOf[name]!)) {
        set.add(name);
        grew = true;
      }
    }
  }
  set.delete(bName);
  return Array.from(set);
}
