# OpenBranch

Nonlinear chat app for LLM conversations with git-like branching and merging.
Live at https://openbranch.app

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
