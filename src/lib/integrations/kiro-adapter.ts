import type { CommonDevelopmentEvent } from "@/types";
import type { LoopArtifact, LoopContext, LoopStepResult } from "./loop-types";

function now() {
  return new Date().toISOString();
}

function goalMarkdown(context: LoopContext) {
  return [
    "# OpenBranch Development Goal",
    "",
    context.goal,
    "",
    "## Feature",
    "",
    "- Key: `" + context.featureKey + "`",
    "- Title: " + context.featureTitle,
    "- Branch: `" + context.branch + "`",
    "",
    "## Expected Behavior",
    "",
    context.behavior,
    "",
    "## Loop Contract",
    "",
    "1. Kiro receives or executes the builder task.",
    "2. Kane verifies the browser behavior only when Kane CLI or Kane Power actually runs.",
    "3. OpenBranch records the result and writes the next action.",
  ].join("\n");
}

export function createGoal(context: LoopContext): LoopStepResult {
  const artifact: LoopArtifact = {
    path: ".tmp/openbranch-goal.md",
    filename: "openbranch-goal.md",
    mime: "text/markdown",
    content: goalMarkdown(context),
  };
  const event: CommonDevelopmentEvent = {
    id: "control_goal_" + Date.now().toString(36),
    timestamp: now(),
    source: "user",
    type: "goal",
    status: "goal",
    label: "Goal proposed: " + context.featureTitle,
    parentId: null,
    branchId: "main",
    summary: context.goal,
    intent: context.featureKey,
    metadata: { controlTowerStep: true, featureKey: context.featureKey, featureTitle: context.featureTitle },
  };
  return {
    label: "Goal proposed",
    summary: "OpenBranch created a goal file Kiro can consume.",
    artifacts: [artifact],
    events: [event],
  };
}

export function runBuild(context: LoopContext): LoopStepResult {
  const event: CommonDevelopmentEvent = {
    id: "control_build_" + Date.now().toString(36),
    timestamp: now(),
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Kiro task prepared: " + context.featureTitle,
    parentId: null,
    branchId: context.branch,
    summary: "OpenBranch prepared the branch handoff for Kiro. This event does not claim Kiro implemented code.",
    detail: ["Goal file: .tmp/openbranch-goal.md", "Behavior to verify: " + context.behavior],
    intent: context.featureKey,
    metadata: {
      controlTowerStep: true,
      featureKey: context.featureKey,
      featureTitle: context.featureTitle,
      kiroExecuted: false,
      executionArtifacts: [".tmp/openbranch-goal.md"],
    },
  };
  return {
    label: "Kiro task prepared",
    summary: "OpenBranch prepared the branch handoff for Kiro; use `npm run openbranch:real-loop` to attempt recorded Kiro execution.",
    commands: [{ label: "Kiro chat handoff", command: "kiro chat --mode agent --add-file .tmp/openbranch-goal.md \"Build this task\"" }],
    events: [event],
  };
}

export function runVerification(context: LoopContext): LoopStepResult {
  const event: CommonDevelopmentEvent = {
    id: "control_kiro_verify_" + Date.now().toString(36),
    timestamp: now(),
    source: "kiro",
    type: "verify",
    status: "verifying",
    label: "Kane verification task prepared: " + context.featureTitle,
    parentId: null,
    branchId: context.branch,
    summary: "Kiro prepared the verification request. This event does not claim Kane executed.",
    detail: ["Kane result target: .tmp/kane-result.json", "Behavior to verify: " + context.behavior],
    intent: context.featureKey,
    metadata: {
      controlTowerStep: true,
      featureKey: context.featureKey,
      featureTitle: context.featureTitle,
      kaneExecuted: false,
      executionArtifacts: [".tmp/kane-verification-task.md"],
    },
  };
  return {
    label: "Kiro verification handoff",
    summary: "Kiro delegates verification to Kane through the `.tmp/kane-result.json` bridge.",
    commands: [{ label: "Kane Power command", command: "kane-cli run \"" + context.behavior.replace(/"/g, "'") + "\" --agent --headless --timeout 120 > .tmp/kane-result.json" }],
    events: [event],
  };
}

export function ingestResult(context: LoopContext, result: Record<string, unknown>): LoopStepResult {
  const passed = result.success === true || result.status === "passed";
  const failure = typeof result.failure === "string" ? result.failure : "See `.tmp/kane-result.json` for Kane's result.";
  return {
    label: "Kiro ingested Kane result",
    summary: passed
      ? "Kane passed; Kiro can prepare the branch for acceptance."
      : "Kane failed; Kiro should fix `" + context.branch + "` next. " + failure,
  };
}

export function generateNextAction(context: LoopContext, failure: string): LoopStepResult {
  const content = [
    "# Kiro Next Action",
    "",
    "Fix the branch based on Kane's latest verification result.",
    "",
    "## Behavior Kane Tested",
    "",
    context.behavior,
    "",
    "## Failure",
    "",
    failure || "Inspect `.tmp/kane-result.json` and patch the behavior Kane rejected.",
    "",
    "## Required Fix",
    "",
    "Update `" + context.branch + "` so Kane can re-run the same verification and pass.",
  ].join("\n");
  return {
    label: "Debug instruction generated",
    summary: "OpenBranch generated `.tmp/kiro-next-action.md` for the next Kiro/Codex fix.",
    artifacts: [{ path: ".tmp/kiro-next-action.md", filename: "kiro-next-action.md", mime: "text/markdown", content }],
  };
}
