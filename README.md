# OpenBranch for AI Development

Kane CLI Hack Day submission.

OpenBranch is a control tower for AI development. Codex PM keeps the goal
through the OpenAI/Codex API, Kiro is the builder surface, Kane verifies when
its CLI actually runs, and OpenBranch records the loop as a visual development
story.

Git shows what changed in code. OpenBranch shows how an AI development idea
moved through planning, building, verification, failure, repair, and
acceptance.

## What It Is

OpenBranch turns AI development work into a live graph and Story View. Instead
of reading scattered terminal output, agent notes, and verification logs, a
judge can watch the idea move through the loop:

1. User goal
2. Kiro plan or build attempt
3. Kane verification
4. Failure and fix branch, if needed
5. Kane pass
6. Accepted idea merged back into the main story

## Roles

- Codex = PM / goal keeper
- Kiro = Builder
- Kane = Verifier
- OpenBranch = control tower + memory + story layer

## Current Integration Status

- Codex: yes, real API execution is available through `OPENAI_API_KEY` using
  the configured `OPENBRANCH_PM_MODEL`. The PM writes
  `.tmp/codex-run.log`, generates the development plan, acceptance criteria,
  Kiro build task, Kane verification task, and post-Kane next action. If no API
  key is present, OpenBranch falls back to `Codex PM fallback mode` and does not
  claim API execution.
- Kiro: yes, real CLI invocation is available through `kiro chat --mode ask
  --add-file .tmp/kiro-build-task.md ...`. The current MVP proves Kiro can be
  invoked and can consume the task file; it does not claim Kiro implemented code
  unless `.tmp/kiro-run.log` or a later diff proves implementation.
- Kane: yes, real Kane CLI execution is available through `kane-cli run ... --agent`. The
  current real-loop run invoked Kane against `http://127.0.0.1:5173` and passed.
  OpenBranch still supports ingesting existing Kane Power sessions; those are
  labeled as ingested results, not as executions triggered by OpenBranch.

## Problem

AI development is becoming a loop of planning, code generation, browser
testing, repair, and retry. The work is real, but the history is hard to see.
Git records code changes after the fact; OpenBranch records the development
process while it happens.

## How the Loop Works

The MVP uses a file-based event bridge plus a real execution runner:

1. Codex writes the goal and keeps the loop pointed at the requested outcome.
2. Kiro receives `.tmp/kiro-build-task.md` and, in real-loop mode, OpenBranch
   invokes Kiro CLI and records `.tmp/kiro-run.log`.
3. Kane receives `.tmp/kane-verification-task.md` and, in real-loop mode,
   OpenBranch invokes Kane CLI and records `.tmp/kane-run.log`.
4. OpenBranch ingests Kane CLI stdout or Kane Power output into `events.jsonl`.
5. If Kane fails, OpenBranch creates a fix branch and writes Kiro's next action.
6. If Kane passes, OpenBranch records the accepted idea and shows the merge back
   into the main development story.

Events are JSONL records with fields such as `id`, `type`, `source`, `status`,
`branch`, `parentId`, `title`, `summary`, `ts`, and `payload`.

## Run the Demo

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Optional environment for the real Codex PM:

```bash
OPENAI_API_KEY=...
OPENBRANCH_PM_MODEL=gpt-5.2
```

The CLI commands load `.env.local`, `.env`, `OPENBRANCH_ENV_FILE`, or
`--env-file <path>` when present, so a local untracked env file is enough for
judge/demo runs.

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), switch to `Code Mode`, keep
`Story View` selected, type this prompt, and press Enter:

```text
Improve the AI Team Loop status card visibility
```

`Shift+Tab` toggles between `Chat Mode` for discussion and `Code Mode` for the
AI Team Loop.

OpenBranch starts a fresh AI Team Loop session and unfolds three rounds:

```text
Round 1: Codex interprets -> Kiro first attempt -> Kane failure
Round 2: Codex reframes -> Kiro fix branch -> Kane partial pass
Round 3: Codex narrows -> Kiro finalizes -> Kane pass -> accepted lesson
```

The prompt submit path writes the handoff files, appends `events.jsonl`, and
updates the graph without requiring separate Kane, Ingest, Next, Accept, or
Codex button clicks. The branches show the first experiment, the visibility fix,
the verification pass, and the merge back to the main story.

Deterministic demo command:

```bash
npm run openbranch:team-story -- "Improve the AI Team Loop status card visibility"
```

This command appends a new three-round story with an initial failure, a
correction, a pass, and an accepted lesson. When real Kane Power output is
available, OpenBranch references it; if Kane only has a single pass or no local
session output is available, the earlier failure/pass rounds are marked as
demo-safe synthesized verification.

Those debugging actions are still available under `Manual tools`, but the main
demo path is one prompt.

OpenBranch improves OpenBranch:

```bash
npm run openbranch:self-improve -- --env-file .env.local
```

This is the real self-improvement demo. It requires `OPENAI_API_KEY` in the
untracked `.env.local`, asks Codex PM for the goal, acceptance criteria, Kiro
task, Kane task, and accepted lesson, invokes Kiro with the generated task,
applies one deterministic allowlisted UI patch, runs `npm run typecheck`,
`npm run build`, and then runs real `kane-cli` against
`http://127.0.0.1:5173`.

Each run creates a unique session id, appends the story to `events.jsonl`, saves
the latest report files in `.tmp`, preserves a non-overwritten copy under
`.tmp/self-improve-sessions/<session-id>/`, and exposes the saved session to the
app so it appears in Recents after restart.

Emergency fallback Mock Demo:

```bash
npm run openbranch:self-improve:mock
```

The app also exposes a visible `Run Mock Demo` button near `Code Mode`. This
creates a new `Mock Demo` session without API keys or Kiro, labels PM/Kiro as
simulated, attempts a real Kane CLI case when Kane is available, and clearly
marks fixture fallback when Kane cannot provide the pass evidence. It writes:

```text
.tmp/self-improve-mock-report.md
.tmp/kane-case-results.json
```

Secondary/manual control-loop command:

```bash
npm run openbranch:loop -- --reset
```

Real execution loop:

```bash
npm run openbranch:real-loop -- --reset
```

This command asks the real Codex PM API for the plan when an API key is
available, writes capability reports, invokes Kiro when available, invokes Kane
when available, stores execution logs, and appends the real execution story to
`events.jsonl`.

To point at a specific env file:

```bash
npm run openbranch:real-loop -- --env-file .env.local --reset
```

To make the loop fail fast unless the PM API actually runs:

```bash
npm run openbranch:real-loop -- --env-file .env.local --require-codex-api --reset
```

Codex PM API smoke test:

```bash
npm run codex:test
```

This command reads `OPENAI_API_KEY`, calls the configured PM model, generates a
small plan, and writes `.tmp/codex-run.log`. Without a key it exits non-zero so
the missing real API evidence is visible.

```bash
npm run codex:test -- --env-file .env.local
```

Optional Kane Power helpers:

```bash
npm run kane:watch
npm run kane:ingest -- --latest-session
```

## Kane Power Integration

Kane Power writes verification session output here:

```text
~/.testmuai/kaneai/sessions/<session-id>/runs/<run>/run-test/actions.ndjson
```

OpenBranch prefers real Kane Power output when it is available. The adapter can
ingest the latest local Kane Power session with:

```bash
npm run kane:ingest -- --latest-session
```

It can also watch the Kane Power session directory:

```bash
npm run kane:watch
```

In this shell, direct `kane-cli` is not currently on PATH. The app therefore
supports ingesting real Kane Power session output from the local session
directory. When direct Kane CLI output is available, the same adapter is
structured to parse Kane's agent NDJSON stream.

## Real vs Fallback Mode

Real-loop mode invokes Kane CLI directly when `kane-cli` is available and stores
the run in `.tmp/kane-run.log` plus `.tmp/kane-result.json`.

Ingest mode uses the latest Kane Power `actions.ndjson` file from the local
session directory. That is real Kane evidence, but OpenBranch labels it as an
ingested result unless this run launched Kane itself.

Fallback mode uses bundled fixtures only for demo safety, so the live graph can
still run if no Kane session output is available on the judge machine. The loop
prefers real execution, then real session ingestion, then fixtures.

## Generated Files

- `events.jsonl` - live OpenBranch development events
- `.tmp/integration-surfaces.json` - detected Kiro, Kane, and Codex surfaces
- `.tmp/codex-run.log` - Codex PM prompt, model, generated plan, timestamp, and API status
- `.tmp/codex-pm-plan.json` - latest Codex PM plan used by the real-loop runner
- `.tmp/codex-pm-feedback.json` - Codex PM response after Kane feedback, when the API runs
- `.tmp/kiro-capabilities.json` - Kiro CLI findings and claim boundary
- `.tmp/kane-capabilities.json` - Kane CLI/Power findings and latest run status
- `.tmp/kiro-run.log` - Kiro command, status, stdout, stderr
- `.tmp/kane-run.log` - Kane command, status, stdout, stderr
- `.tmp/openbranch-goal.md` - goal handoff for Kiro
- `.tmp/codex-goal.md` - goal keeper handoff for Codex
- `.tmp/kiro-build-task.md` - builder task for Kiro
- `.tmp/kane-verification-task.md` - verifier task for Kane
- `.tmp/kane-result.json` - normalized Kane verification result
- `.tmp/kiro-next-action.md` - next builder action after Kane verification
- `~/.testmuai/kaneai/sessions/<session-id>/runs/<run>/run-test/actions.ndjson`
  - real Kane Power verification events

## Live Demo Story

The demo shows OpenBranch recording an AI development loop:

```text
User Goal -> Codex PM Reframed Goal -> Codex PM Plan Generated -> Kiro Builder Executed -> Kane Verifier Executed -> Verification Passed -> Codex PM Accepted Lesson -> Accepted Lesson
```

If `OPENAI_API_KEY` is missing, the Codex node is labeled `Codex PM fallback
mode` instead, and the Kiro/Kane demo still runs.

The point is not just that the app was tested. The point is that the testing,
failure, repair, and acceptance become visible as a reusable development
history.

## 3-Minute Demo Script for Judges

1. Start the app:

```bash
npm run dev
```

2. In the browser, open [http://localhost:5173](http://localhost:5173), switch
   to `Live Mode`, and select `Story View`.

3. Type one development prompt into the chat box and press Enter.

4. Point out the role progress message: Codex is planning, Kiro is preparing,
   Kane is checking, and OpenBranch is recording the story.

5. Point out the Kane verification event. In real-loop mode the event includes
   the exact Kane CLI command, exit status, `.tmp/kane-run.log`, and
   `.tmp/kane-result.json`.

6. Open or mention `.tmp/kiro-next-action.md` to show the builder's next step.

7. Return to Story View and show the accepted idea. The final judge takeaway:
   OpenBranch shows how an AI development idea moved from goal to verification
   to acceptance.

## Why This Matters

AI teams need more than generated code. They need an auditable memory of what
the agents tried, where verification failed, what changed next, and why the
result was accepted. OpenBranch makes that loop visible.

## Hackathon Scoring Fit

- Kane CLI usage: ingests real Kane Power `actions.ndjson` session output and is
  now able to trigger `kane-cli run ... --agent` directly when the CLI is
  available.
- Built with Kiro: treats Kiro as the Builder, generates Kiro-ready build and
  next-action files, and records Kiro CLI invocation separately from any claim
  that code was implemented.
- Works live: prompt submit writes the local file bridge and updates
  `events.jsonl`; the loop command remains available as a manual fallback.
- Idea/usefulness: gives AI development teams a shared control tower for
  planning, verification, repair, and acceptance.
- Craft/polish: includes Story View, graph events, real/fallback verification
  paths, and concise judge-facing commands.

## Contact

Built by [Elden Sari](https://github.com/eldengu).

## License

Apache-2.0
