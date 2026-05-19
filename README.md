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

OpenBranch runs every message through an AI team. A **Master** agent in the main
chat delegates to **Executor**, **Validator**, and **Critic** agents in separate
branches. The team catches hallucinations a single agent would confidently
produce. The Master reports the final verdict in plain Korean for non-technical
end users.

```
main:    [user msg] → 🟣 Master delegates → 🟣 Master synthesizes (Korean report)
              ↘ 🟢 Executor branch — generates the answer
              ↘ 🟡 Validator branch — fact-checks Executor (UNVERIFIED / VERIFIED / PARTIAL)
              ↘ 🔴 Critic   branch — finds weaknesses (REJECT / APPROVE / WARN)
```

The flow auto-triggers on every send — no extra button. Run **"Try the demo"**
on the welcome screen for the canonical `asyncpg-listen` phantom-library test:
the Executor confidently writes code for a package that doesn't exist on PyPI,
and the team catches it.

Inspired by AWS Strands' `Swarm` orchestration (Module 3 of the AWS
"Stop AI Agent Hallucinations" workshop). What AWS does in Python code,
OpenBranch does as a live visual graph.

## Neo4j Graph Storage

Every validation session is stored as a queryable graph in **Neo4j Aura** — the
same graph database used in Module 1 (Graph-RAG) of the AWS workshop.

Configure via the bottom-right `💾` badge or via `VITE_NEO4J_URI`,
`VITE_NEO4J_USERNAME`, `VITE_NEO4J_PASSWORD` env vars. If unconfigured, the
team flow still runs; only the persistence step is skipped.

Schema:

```
(:Session {id, user_prompt, started_at, completed_at, total_duration_ms, final_verdict})
  -[:CONTAINS]-> (:AgentRun {id, role, provider, model, started_at, completed_at, duration_ms, content, verdict})

(:AgentRun {role:'executor'})  -[:WROTE_FOR]-> (:Session)
(:AgentRun {role:'validator'}) -[:VERIFIED]->  (:AgentRun {role:'executor'})
(:AgentRun {role:'critic'})    -[:CRITIQUED]-> (:AgentRun {role:'executor'})
(:AgentRun {role:'master'})    -[:SYNTHESIZED]-> (:AgentRun {role:'validator'})
(:AgentRun {role:'master'})    -[:SYNTHESIZED]-> (:AgentRun {role:'critic'})
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
