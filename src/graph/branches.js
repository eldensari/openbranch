// Display label for a branch. Unified across sidebar + graph tabs.
// 1. branchTitles override (user rename)
// 2. "main" stays literal (well-known)
// 3. First commit prompt on that branch
// 4. Fallback to branch identifier (should be rare)
export function getBranchLabel(commits, branchName, branchTitles) {
  const custom = branchTitles?.[branchName];
  if (custom) return custom;
  if (branchName === "main") return "main";
  const firstOnBranch = (commits || []).filter(c => c.branch === branchName).sort((a, b) => a.ts - b.ts)[0];
  const prompt = firstOnBranch?.prompt;
  if (!prompt) return branchName;
  return prompt.replace(/\s+/g, " ").trim();
}

// Build a hierarchical list of non-main branches. Each branch's parent is determined
// by the branch of its first commit's parentId. Output: [{ branch, depth, label }, ...]
// walked depth-first, ordered by first commit ts at each level.
export function buildBranchTree(commits) {
  if (!commits.length) return [];
  const byBranch = {};
  for (const c of commits) (byBranch[c.branch] || (byBranch[c.branch] = [])).push(c);

  const info = {};
  for (const [name, list] of Object.entries(byBranch)) {
    const first = list.reduce((a, b) => a.ts < b.ts ? a : b);
    const parentCm = first.parentId ? commits.find(c => c.id === first.parentId) : null;
    const parentBranch = parentCm && parentCm.branch !== name ? parentCm.branch : null;
    info[name] = { name, firstCommit: first, parentBranch, children: [] };
  }
  for (const b of Object.values(info)) {
    if (b.parentBranch && info[b.parentBranch]) info[b.parentBranch].children.push(b.name);
  }
  for (const b of Object.values(info)) {
    b.children.sort((x, y) => info[x].firstCommit.ts - info[y].firstCommit.ts);
  }

  const result = [];
  const visited = new Set();
  const walk = (name, depth) => {
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
  // Orphans (branches whose parent branch is missing) start at depth 1
  for (const b of Object.values(info)) if (!visited.has(b.name)) walk(b.name, 1);

  return result;
}

export function commitBranch(cv, commitId) {
  return (cv.commits || []).find(c => c.id === commitId)?.branch || null;
}

export function branchPathToRoot(commits, branchName) {
  if (!branchName || branchName === "main") return [];
  const branchTree = buildBranchTree(commits || []);
  const byName = {};
  branchTree.forEach(b => { byName[b.branch] = b; });
  const path = [];
  let cur = branchName;
  while (cur && cur !== "main" && byName[cur]) {
    path.unshift(cur);
    cur = byName[cur].parentBranch;
  }
  return path;
}

export function getBranchDescendantNames(cms, bName) {
  if (!cms.length) return [];
  const byBranch = {};
  for (const c of cms) (byBranch[c.branch] || (byBranch[c.branch] = [])).push(c);
  const parentOf = {};
  for (const [name, list] of Object.entries(byBranch)) {
    const first = list.reduce((a, b) => a.ts < b.ts ? a : b);
    const parentCm = first.parentId ? cms.find(c => c.id === first.parentId) : null;
    parentOf[name] = parentCm && parentCm.branch !== name ? parentCm.branch : null;
  }
  const set = new Set([bName]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of Object.keys(byBranch)) {
      if (!set.has(name) && parentOf[name] && set.has(parentOf[name])) {
        set.add(name); grew = true;
      }
    }
  }
  set.delete(bName);
  return Array.from(set);
}
