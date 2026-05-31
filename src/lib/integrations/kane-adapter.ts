import type { CommonDevelopmentEvent } from "@/types";
import type { LoopArtifact, LoopContext, LoopStepResult } from "./loop-types";

function now() {
  return new Date().toISOString();
}

export function createGoal(context: LoopContext): LoopStepResult {
  return {
    label: "Kane verification goal",
    summary: "Kane will verify `" + context.featureTitle + "` using the behavior contract from `.tmp/openbranch-goal.md`.",
    commands: [{ label: "Inspect goal", command: "type .tmp\\openbranch-goal.md" }],
  };
}

export function runBuild(context: LoopContext): LoopStepResult {
  return {
    label: "Kane build gate",
    summary: "Kane does not build the app; it gates the `" + context.branch + "` build by verifying browser behavior.",
  };
}

export function runVerification(context: LoopContext): LoopStepResult {
  const event: CommonDevelopmentEvent = {
    id: "control_verify_" + Date.now().toString(36),
    timestamp: now(),
    source: "kane",
    type: "verify",
    status: "verifying",
    label: "Kane verification task prepared: " + context.featureTitle,
    parentId: null,
    branchId: context.branch,
    summary: "OpenBranch prepared a Kane CLI verification command. This event does not claim the command has executed.",
    intent: context.featureKey,
    metadata: {
      controlTowerStep: true,
      featureKey: context.featureKey,
      featureTitle: context.featureTitle,
      kaneBehavior: context.behavior,
      kaneExecuted: false,
      executionArtifacts: [".tmp/kane-verification-task.md"],
    },
  };
  return {
    label: "Kane verification task prepared",
    summary: "Use `npm run openbranch:real-loop` to run Kane and record `.tmp/kane-run.log`; this manual action only prepares the command.",
    commands: [
      {
        label: "Kane Power command",
        command: "kane-cli run \"" + context.behavior.replace(/"/g, "'") + "\" --agent --headless --timeout 120 > .tmp/kane-result.json",
      },
      {
        label: "OpenBranch ingest",
        command: "npm run kane:ingest -- --input .tmp/kane-result.json --branch " + context.branch + " --feature " + context.featureKey + " --feature-title \"" + context.featureTitle + "\"",
      },
    ],
    events: [event],
  };
}

export function ingestResult(context: LoopContext, result: Record<string, unknown>): LoopStepResult {
  const passed = result.success === true || result.status === "passed" || result.event === "reverification_passed";
  const behavior = typeof result.behavior === "string" ? result.behavior : context.behavior;
  const failure = typeof result.failure === "string" ? result.failure : "Kane reported a failure.";
  const evidence = Array.isArray(result.evidence) ? result.evidence.map(String) : [];
  const artifact: LoopArtifact = {
    path: ".tmp/kane-result.json",
    filename: "kane-result.json",
    mime: "application/json",
    content: JSON.stringify(result, null, 2),
  };
  const event: CommonDevelopmentEvent = {
    id: "control_kane_" + Date.now().toString(36),
    timestamp: now(),
    source: "kane",
    type: passed ? "pass" : "fail",
    status: passed ? "passed" : "failed",
    label: (passed ? "Kane verification passed: " : "Kane verification failed: ") + behavior,
    parentId: null,
    branchId: context.branch,
    summary: passed ? "OpenBranch ingested a passing Kane result for " + behavior + "." : "OpenBranch ingested a failing Kane result: " + failure,
    detail: [
      "Kane tested: " + behavior,
      passed ? "Evidence: " + (evidence[0] || "Passing result") : "Failure: " + failure,
      "Raw Kane result: " + JSON.stringify(result),
    ],
    intent: context.featureKey,
    metadata: {
      controlTowerStep: true,
      featureKey: context.featureKey,
      featureTitle: context.featureTitle,
      kaneBehavior: behavior,
      kaneFailure: passed ? undefined : failure,
      kaneEvidence: evidence,
      rawKaneResult: result,
      kaneExecuted: result.executionMode === "kane_cli" || result.kaneExecuted === true,
      existingKaneRun: result.executionMode === "existing_kane_power",
      executionArtifacts: [".tmp/kane-result.json"],
    },
  };
  return {
    label: passed ? "Kane verification passed" : "Kane verification failed",
    summary: "OpenBranch ingested Kane output and converted it into a graph event.",
    artifacts: [artifact],
    events: [event],
  };
}

export function generateNextAction(context: LoopContext, result: Record<string, unknown>): LoopStepResult {
  const failure = typeof result.failure === "string" ? result.failure : "Inspect `.tmp/kane-result.json` for the failing behavior.";
  return {
    label: "Kane next-action input",
    summary: failure,
  };
}
