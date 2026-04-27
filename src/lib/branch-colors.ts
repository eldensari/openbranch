/**
 * Branch identity colors. These reference CSS variables defined in index.css
 * (--branch-0 ... --branch-7), which flip between light and dark mode
 * automatically via the .dark class on <html>.
 */
export const BRANCH_VARS = [
  "var(--branch-0)",
  "var(--branch-1)",
  "var(--branch-2)",
  "var(--branch-3)",
  "var(--branch-4)",
  "var(--branch-5)",
  "var(--branch-6)",
  "var(--branch-7)",
];

const FALLBACK = "var(--muted-foreground)";

export function bCol(names: string[], branch: string): string {
  const i = names.indexOf(branch);
  if (i < 0) return FALLBACK;
  return BRANCH_VARS[i % BRANCH_VARS.length];
}
