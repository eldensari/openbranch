import type { CommonDevelopmentEvent } from "@/types";
import type { IntegrationSurface, LoopAction, LoopArtifact, LoopContext, LoopStepResult } from "./loop-types";
import * as kiro from "./kiro-adapter";
import * as kane from "./kane-adapter";
import * as codex from "./codex-adapter";

export const CONTROL_TOWER_FILES = {
  goal: ".tmp/openbranch-goal.md",
  kaneResult: ".tmp/kane-result.json",
  nextAction: ".tmp/kiro-next-action.md",
  codexGoal: ".tmp/codex-goal.md",
  kiroBuildTask: ".tmp/kiro-build-task.md",
  kaneVerificationTask: ".tmp/kane-verification-task.md",
};

export const DEFAULT_CONTROL_TOWER_CONTEXT: LoopContext = {
  goal: "Close the Kiro/Kane/Codex loop through OpenBranch.",
  featureKey: "control-tower-loop",
  featureTitle: "Control Tower Loop",
  branch: "feature/control-tower-loop",
  behavior: "OpenBranch creates a goal, Kane verifies browser behavior, and OpenBranch writes the next debugging action.",
  eventsFile: "events.jsonl",
};

export function createBrowserIntegrationSurfaces(): IntegrationSurface[] {
  return [
    {
      name: "kiro",
      available: true,
      mode: "file_bridge",
      notes: "Browser UI can export `.tmp/openbranch-goal.md`; `npm run openbranch:real-loop` probes and invokes Kiro CLI when available.",
    },
    {
      name: "kane",
      available: true,
      mode: "kane_power",
      notes: "Real execution is recorded only by `npm run openbranch:real-loop`; otherwise OpenBranch ingests explicit Kane output as a result artifact.",
    },
    {
      name: "codex",
      available: true,
      mode: "api",
      notes: "`npm run codex:test` and `npm run openbranch:real-loop` use OPENAI_API_KEY for real Codex PM execution; browser fallback still writes `.tmp/codex-goal.md`.",
    },
    {
      name: "file_bridge",
      available: true,
      mode: "file_bridge",
      notes: "The reliable local bridge is `events.jsonl` plus `.tmp/*.md` and `.tmp/*.json` artifacts.",
    },
  ];
}

export function createControlTowerEvent(
  context: LoopContext,
  type: "task" | "merge",
  label: string,
  summary: string,
  parentId: string | null = null,
): CommonDevelopmentEvent {
  return {
    id: "control_" + type + "_" + Date.now().toString(36),
    timestamp: new Date().toISOString(),
    source: type === "merge" ? "merge" : "system",
    type,
    status: type === "merge" ? "merged" : "tasked",
    label,
    parentId,
    branchId: type === "merge" ? "main" : context.branch,
    summary,
    intent: context.featureKey,
    metadata: {
      controlTowerStep: true,
      featureKey: context.featureKey,
      featureTitle: context.featureTitle,
    },
  };
}

export function createControlTowerAction(
  action: LoopAction,
  context: LoopContext = DEFAULT_CONTROL_TOWER_CONTEXT,
): LoopStepResult {
  if (action === "run_kane_verification") return kane.runVerification(context);
  if (action === "ingest_kane_result") {
    return kane.ingestResult(context, {
      event: "verification_failed",
      behavior: context.behavior,
      failure: "Kane result file has not been replaced yet. Run `npm run kane:ingest -- --latest-session`, `npm run kane:watch`, or `npm run openbranch:loop`.",
      evidence: [],
    });
  }
  if (action === "generate_kiro_next_action") {
    const next = kiro.generateNextAction(context, "Use `.tmp/kane-result.json` to repair the failing browser behavior, then rerun Kane.");
    return {
      ...next,
      events: [createControlTowerEvent(context, "task", "Debug instruction generated", next.summary)],
    };
  }
  if (action === "mark_idea_accepted") {
    return {
      label: "Mark Idea Accepted",
      summary: "OpenBranch records the verified branch as accepted into main when the result artifact supports that claim.",
      events: [createControlTowerEvent(context, "merge", "Idea accepted: " + context.featureTitle, "The result artifact supports accepting the idea into main.")],
    };
  }
  return codex.createGoal(context);
}

export function createInitialLoopArtifacts(context: LoopContext = DEFAULT_CONTROL_TOWER_CONTEXT): LoopArtifact[] {
  return [
    ...(kiro.createGoal(context).artifacts || []),
    ...(codex.createGoal(context).artifacts || []),
    {
      path: CONTROL_TOWER_FILES.kiroBuildTask,
      filename: "kiro-build-task.md",
      mime: "text/markdown",
      content: [
        "# Kiro Builder Task",
        "",
        context.goal,
        "",
        "Prepare or implement the build attempt for `" + context.branch + "`.",
      ].join("\n"),
    },
    {
      path: CONTROL_TOWER_FILES.kaneVerificationTask,
      filename: "kane-verification-task.md",
      mime: "text/markdown",
      content: [
        "# Kane Verification Task",
        "",
        context.behavior,
        "",
        "Prefer real Kane Power output from `~/.testmuai/kaneai/sessions/<session-id>/runs/<run>/run-test/actions.ndjson`.",
      ].join("\n"),
    },
    {
      path: CONTROL_TOWER_FILES.kaneResult,
      filename: "kane-result.json",
      mime: "application/json",
      content: JSON.stringify({
        event: "verification_failed",
        behavior: context.behavior,
        failure: "Replace this file with real Kane Power NDJSON/JSON output, run `npm run kane:ingest -- --latest-session`, or run `npm run openbranch:loop`.",
      }, null, 2),
    },
    ...(kiro.generateNextAction(context, "Waiting for Kane result.").artifacts || []),
  ];
}

export type { LoopAction, LoopArtifact, LoopContext, LoopStepResult, IntegrationSurface };
