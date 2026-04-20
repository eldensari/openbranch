# OpenBranch

Nonlinear chat app for LLM conversations with git-like branching and merging.
Live at https://openbranch.app

## 대화 스타일

- 한국어로, 5살 유치원생에게 설명하듯 짧고 쉽게 답해.
- 긴 문단보다 불릿·표·이모지를 활용해서 한눈에 보이게.
- 개념은 비유로 풀어 (예: rebase = "책상 옮기기").
- **단, 기술 식별자는 정확히**: 파일 경로, 함수 이름, 명령어, 커밋 해시, 브랜치 이름은 그대로 쓰고 쉬운 말로 바꾸지 마.
- 사용자가 "자세히", "기술적으로", "코드 리뷰" 같은 말을 하면 이 스타일은 잠시 해제하고 정식 톤으로.

## Commands

```bash
npm run dev        # start Vite dev server on port 5173
npm run build      # build to dist/
npm run preview    # preview production build
```

## Architecture

- **Stack**: React 19 + Vite 6 + Tailwind CSS 4 + Netlify
- **No external UI libraries** - all components built with React + inline styles
- **No routing library** - single-page app, conversation switching via sidebar
- **No state management library** - pure React hooks (useState, useEffect, useRef)
- **Persistence**: localStorage with `ob:` namespace prefix (via `src/lib/storage.js`)

### File Structure

```
src/
  App.jsx              # Monolithic main component (~800 lines): UI, state, handlers
  main.jsx             # React entry point
  index.css            # Tailwind import + custom scrollbar hiding
  seed-moby-dick.js    # Demo seed data loaded on first visit
  lib/
    storage.js         # localStorage wrapper (ob: namespace)
    llm.js             # LLM API abstraction (BYOK: Anthropic/OpenAI/Gemini + free proxy)
  assets/
    herb.svg           # Logo icon
netlify/
  functions/
    chat.js            # Free-tier LLM proxy (rate-limited 10/day per IP)
    waitlist.js        # Email collection via Netlify Blobs
public/
  favicon.svg          # Herb emoji SVG favicon
```

### Data Model

Git-like commit/branch/HEAD system (not real git):
- **Commit**: `{ id, parentId, mergeIds[], branch, ts, prompt, response }`
- **Conversation**: `{ id, title, commits[], headId, branch, parentRef, u }`
- **Branches**: Named branches (main, branch-0, ...) tracked by `commit.branch`
- **HEAD**: `headId` tracks current position; new messages append from HEAD
- **Merges**: Commits with `mergeIds[]` synthesize content from multiple branches
- **Nested conversations**: Parent/child tree via `parentRef` (convId + commitId)

### LLM Integration

- BYOK (Bring Your Own Key): Anthropic (`sk-ant-`), OpenAI (`sk-`), Gemini (`AI`)
- Free tier: Netlify function proxy to Anthropic API, 10 requests/day per IP
- Provider detection by API key prefix in `src/lib/llm.js`

### Styling

- Inline `style` objects with theme color values from `t` (theme object)
- Two complete color palettes: LIGHT and DARK, defined in App.jsx
- Branch colors via `bCol(names, branch)` helper
- Only CSS class: `.graph-scroll` for scrollbar hiding

## Coding Conventions

- **Abbreviations in state**: `t` = theme, `mm` = merge mode, `sel` = selected, `cm` = commit, `cv` = conversation, `cid` = commit ID, `hid` = head ID, `br` = branch
- **Naming**: camelCase for functions/variables, PascalCase for components
- **Imports**: Named imports from React, default import for storage, named for llm
- **Icons**: Inline SVG components (SunIcon, MoonIcon, GitHubIcon)
- **No TypeScript** - plain JSX throughout

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
