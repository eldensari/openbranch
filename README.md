# 🌿 OpenBranch

**Branch to explore in your chat**

A nonlinear chat app for LLM conversations. 

![OpenBranch screenshot](https://openbranch.app/screenshot.png)

## Features

- **Branch** — Edit any message to fork a new branch and explore a different direction
- **Merge** — Combine insights from multiple branches into one thread
- **Graph visualization** — See the shape of your reasoning as a git-style commit graph
- **Dark / Light mode** — Toggle with one click
- **BYOK** — Bring Your Own Key. Supports Anthropic, OpenAI, and Gemini
- **🟣 AI Team Validation** — Every message runs a 4-role live team (Master · Executor · Validator · Critic), see below

## Multi-Agent Team Validation

> **Branch+merge IS the multi-agent primitive — made literal here.**
>
> OpenBranch already has git-style branches and merge commits. The AI team
> doesn't bolt orchestration on top — it *uses* the existing primitives. Three
> persistent worker branches (🟢 Executor, 🟡 Validator, 🔴 Critic) sprout from
> the user's message and live across rounds. Master's synthesis on the main
> thread is literally a multi-parent **merge commit** that pulls the three
> worker outputs together. Each round adds another merge.

```
Master:  [User]──[R1 MasterMerge◆]──[R2 MasterMerge◆]──→
            ↓↓↓        ↑                  ↑
            │││        │ merges 3         │ merges 3
            │││        │                  │
🟢 Exec: ────→[R1]──→[R2 Review◆]──→[R2 Execute]──→
🟡 Val:  ────→[R1]──→[R2 Review◆]──→[R2 Execute]──→
🔴 Crit: ────→[R1]──→[R2 Review◆]──→[R2 Execute]──→

◆ = multi-parent merge node (diamond in the graph)
```

**Context discipline:** every node sees ONLY its declared parents — no global
thread state. Lineage IS the prompt:

- R1 Executor: original prompt
- R1 Validator/Critic: prompt + R1 Executor
- R1 MasterMerge: the 3 R1 outs → Korean synthesis
- R2 Review (each worker): own R1 + R1 MasterMerge → strategy plan
- R2 Execute (each worker): own R2 Review + original prompt → new output
- R2 MasterMerge: the 3 R2 Executes → Korean comparison report

The first message auto-triggers Round 1. When R1 Master synthesis contains a
REJECT, a **🔄 Re-run with team feedback** button appears on the diamond.
Clicking it adds **7 new nodes** (3 Review merges + 3 Execute children +
1 R2 MasterMerge) — capped at R2, no R3+.

Inspired by AWS Strands' `Swarm` orchestration (Module 3 of the AWS
"Stop AI Agent Hallucinations" workshop). Strands does this with Python state
in code; OpenBranch does it with branching + merging as the literal primitive.

## Neo4j Graph Storage

Every validation session is stored as a queryable graph in **Neo4j Aura** — the
same graph database used in Module 1 (Graph-RAG) of the AWS workshop.

Configure via the bottom-right `💾` badge or via `VITE_NEO4J_URI`,
`VITE_NEO4J_USERNAME`, `VITE_NEO4J_PASSWORD` env vars. If unconfigured, the
team flow still runs; only the persistence step is skipped.

Schema:

```
(:Session {id, user_prompt, started_at, completed_at, total_duration_ms, final_verdict})
  -[:CONTAINS]-> (:AgentRun {
      id, role, provider, model, started_at, completed_at,
      duration_ms, content, verdict, iteration, executor_phase
  })

// R1 worker lineage
(:AgentRun {role:'executor'})  -[:WROTE_FOR]->  (:Session)
(:AgentRun {role:'validator'}) -[:VERIFIED]->   (:AgentRun {role:'executor'})
(:AgentRun {role:'critic'})    -[:CRITIQUED]->  (:AgentRun {role:'executor'})

// Synthesis merges — multi-parent diamond nodes
(:AgentRun:SynthesisMerge {round})
  -[:MERGES]-> (:AgentRun)  // 3 edges per merge: exec + val + crit

// R2 refinement lineage
(:AgentRun {iteration:2}) -[:REFINES]-> (:AgentRun {iteration:1})
```

Future analysis queries:

- Which model combinations are most reliable?
- Which models does Validator most often flag?
- What patterns appear in rejected sessions?

## Bedrock-Ready

The validation pattern is provider-agnostic. To use Amazon Bedrock-hosted
models, swap the base URL in `src/lib/llm.ts` — the role logic in
`src/lib/orchestrateTeam.ts` stays identical.

## Examples

- [`examples/code-hallucination.md`](examples/code-hallucination.md) — the default demo (asyncpg-listen)
- [`examples/travel-hallucination.md`](examples/travel-hallucination.md) — same pattern, local-knowledge domain

## Tech Stack

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- Deployed on [Netlify](https://www.netlify.com/)
- All data stored in `localStorage` — no server, no sign-up

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Contact

Built by [Elden Sari](https://github.com/eldensari) — reach out at eldensari@proton.me

## License

Apache-2.0

---

[openbranch.app](https://openbranch.app)
