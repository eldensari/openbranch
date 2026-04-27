# OpenBranch

Nonlinear chat app for LLM conversations with git-like branching and merging.
Live at https://openbranch.app

## 대화 스타일

- 한국어로, 5살 유치원생에게 설명하듯 짧고 쉽게 답해.
- 긴 문단보다 불릿·표·이모지를 활용해서 한눈에 보이게.
- 개념은 비유로 풀어 (예: rebase = "책상 옮기기").
- **단, 기술 식별자는 정확히**: 파일 경로, 함수 이름, 명령어, 커밋 해시, 브랜치 이름은 그대로 쓰고 쉬운 말로 바꾸지 마.
- 사용자가 "자세히", "기술적으로", "코드 리뷰" 같은 말을 하면 이 스타일은 잠시 해제하고 정식 톤으로.

## Git Workflow

- Always verify the directory is a git repo (`git rev-parse --git-dir`) before attempting commits
- Pause and confirm with user before committing CHECKPOINT or milestone documents
- When verifying HEAD/commit state, check if target SHA is in history (ancestor), not exact HEAD match
- Use `--no-verify` only as a last resort and explain why; prefer fixing or removing broken hooks

## Commands

```bash
npm run dev        # start Vite dev server on port 5173
npm run build      # build to dist/
npm run preview    # preview production build
```

## Architecture

- **Stack**: React 19 + TypeScript + Vite 6 + Tailwind CSS 4 + shadcn/ui + Netlify
- **No routing library** — single-page app, conversation switching via sidebar
- **No state management library** — pure React hooks (`useState`, `useEffect`, `useRef`)
- **Persistence**: localStorage with `ob:` namespace prefix (via `src/lib/storage.ts`)

### File Structure

```
src/
  App.tsx               # Monolithic main component (~950 lines): state, handlers, layout
  main.tsx              # React entry point
  index.css             # Tailwind + theme CSS variables + .graph-scroll utility
  types.ts              # Shared types: Commit, Conversation, Folder, Tag, Theme
  seed-moby-dick.ts     # Demo seed data loaded on first visit
  lib/
    storage.ts          # localStorage wrapper (ob: namespace)
    llm.ts              # LLM API abstraction (BYOK: Anthropic/OpenAI/Gemini + free proxy)
    utils.ts            # cn() helper for Tailwind class merging
    branch-colors.ts    # Branch color assignment via --branch-0..7 CSS vars
  graph/
    branches.ts         # Branch tree building, descendant walking, labels
    range.ts            # Range selection, clone/cut commits
    model.ts            # Commit creation, thread building, ID helpers
  storage/
    conv.ts             # Conversation persistence (loadAll, persist, delete)
    clusters.ts         # Folder grouping + formatting
    sidebar.ts          # Sidebar branch/item key helpers + layout
  hooks/
    use-mobile.ts       # Mobile breakpoint hook
  components/
    theme-provider.tsx  # useTheme() + ThemeProvider with localStorage persistence
    ui/                 # shadcn/ui primitives (Button, Dialog, DropdownMenu, ...)
  ui/
    Sidebar.tsx         # Left sidebar: hamburger / new chat / search / chats / folders / tags / Settings
    ChatPanel.tsx       # Main chat area: header, thread, composer
    Graph.tsx           # Branch graph visualization
    Markdown.tsx        # Markdown renderer with thinking dots + citations
    ModelPicker.tsx     # Model selection dropdown
  assets/
    herb.svg            # Logo icon
netlify/
  functions/
    chat.js             # Free-tier LLM proxy (rate-limited 10/day per IP)
    waitlist.js         # Email collection via Netlify Blobs
public/
  favicon.svg           # Herb emoji SVG favicon
```

### Data Model

Git-like commit/branch/HEAD system (not real git). Types live in `src/types.ts`:

- **Commit**: `{ id, parentId, mergeIds?, branch, ts, prompt, response, thinking?, attachments?, citations?, ... }`
- **Conversation**: `{ id, title, commits[], headId, branch, parentRef?, clusterId?, u?, branchTitles?, labels? }`
- **Folder**: `{ id, name, convIds[], parentId?, expanded? }`
- **Branches**: Named branches (`main`, `branch-0`, ...) tracked by `commit.branch`
- **HEAD**: `headId` tracks current position; new messages append from HEAD
- **Merges**: Commits with `mergeIds[]` synthesize content from multiple branches
- **Nested conversations**: Parent/child tree via `parentRef` (convId + commitId)

### Sidebar Layout

- Collapses between **rail (w-14, 56px)** and **expanded (w-80, 320px)** via CSS `transition-[width] duration-300`
- Rail shows: hamburger ☰, new chat ✏️, settings ⚙️ (pinned bottom via `flex-1` spacer)
- Expanded shows: hamburger, new chat, search chats, Tags (collapsible), Chats (collapsible, with folders), Settings (footer)
- Search chats opens a Dialog popup with flat time-bucketed list (Today / Yesterday / Previous 7 Days / Previous 30 Days / Older)
- Settings opens a Dialog popup for API key entry
- Hover-reveal kebab menu `⋯` on each conv / branch / folder row (right-click ContextMenu also works)
- Tags / Chats group labels: chevron reveals only on hover (`group-hover`), hiding otherwise

### LLM Integration

- BYOK (Bring Your Own Key): Anthropic (`sk-ant-`), OpenAI (`sk-`), Gemini (`AI`)
- Free tier: Netlify function proxy to Anthropic API, 10 requests/day per IP
- Provider detection by API key prefix in `src/lib/llm.ts`

### Styling

- Tailwind utility classes + CSS variables from `src/index.css` (light + dark palettes)
- Dark mode via `class="dark"` on `<html>`, managed by `src/components/theme-provider.tsx`
- Class merging via `cn()` from `src/lib/utils.ts`
- Branch colors via CSS vars `--branch-0..7`
- Sidebar hover uses `bg-sidebar-accent` (custom tuned `oklch(0.94)` for visible but subtle feedback)
- Custom utility: `.graph-scroll` hides scrollbars

## Coding Conventions

- **TypeScript throughout** — `.tsx` / `.ts` (migration done; `any` is still used in prop destructuring to avoid prop explosion)
- **Abbreviations in state**: `mm` = merge mode, `sel` = selected, `cm` = commit, `cv` = conversation, `cid` = commit ID, `hid` = head ID, `br` = branch
- **Naming**: camelCase for functions/variables, PascalCase for components
- **Imports**: path alias `@/` → `src/` (e.g., `@/components/ui/button`)
- **Icons**: `lucide-react` components (Menu, Search, Settings, SquarePen, ChevronDown, MoreHorizontal, ...)

## Design Conventions

- Prefer explicit parameter threading over module-level globals (e.g., no `EXECUTOR_MODEL` at module scope)
- Use full UUIDs for task_id matching, not short prefixes
- Before proposing refactors, verify code is actually dead by tracing all call sites (don't assume from name alone)

## Background Process Management

- Never launch a long-running benchmark/task without first checking for existing background runs (`ps`, BashOutput on prior shells)
- Track all background bash_ids in a TodoWrite list before spawning new ones
- For benchmark tasks: if process self-terminates with valid data, do NOT mark ABORTED based solely on the 30-min wall-clock rule

## Security

### Secrets Hygiene

- Never echo, commit, or write real API keys to files like `.env.example` — use placeholder values only
- If real secrets are detected in staged/working files, stop immediately and recommend `git checkout` recovery

## Deployment

- **Netlify**: Build with `npm run build`, publish `dist/`
- **SPA redirect**: `/*` -> `/index.html` (200 status) in `netlify.toml`
- **Serverless functions**: `netlify/functions/` auto-deployed

## GStack

GStack is installed at `.claude/skills/gstack/` and provides headless browser testing,
QA, visual review, and deployment skills.

### Key Skills

| Skill | Description |
|-------|-------------|
| `/gstack` | Open and interact with pages in headless Chromium |
| `/qa` | Full QA pass: navigate, interact, verify, screenshot |
| `/review` | Code review with visual context |
| `/design-review` | Visual audit against design specs |
| `/investigate` | Debug issues with browser evidence |
| `/ship` | Pre-ship checklist and verification |
| `/careful` | Production safety checks |
| `/autoplan` | Auto-review and plan from diff |

### Usage

```bash
# QA the local dev server
/qa http://localhost:5173

# Investigate a bug on production
/investigate https://openbranch.app

# Visual review after changes
/design-review http://localhost:5173
```

GStack browse binary: `.claude/skills/gstack/browse/dist/browse`

---

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
