import type { CommonDevelopmentEvent } from "@/types";
import type { LoopArtifact, LoopContext, LoopStepResult } from "./loop-types";

export const DEFAULT_CODEX_PM_MODEL = "gpt-5.2";
export const CODEX_PM_ENDPOINT = "https://api.openai.com/v1/responses";

export type CodexPmPlan = {
  reframedGoal: string;
  developmentPlan: string[];
  acceptanceCriteria: string[];
  kiroBuildTask: string;
  kaneVerificationTask: string;
  nextActionAfterKaneFeedback: string;
  acceptedLesson: string;
  featureTitle: string;
  fallbackReason?: string;
};

export type CodexPmRunResult = {
  apiExecuted: boolean;
  mode: "api" | "fallback";
  model: string;
  apiKeySource: "OPENAI_API_KEY" | "";
  prompt: string;
  plan: CodexPmPlan;
  rawText: string;
  responseStatus: number | null;
  responseId?: string;
  startedAt: string;
  endedAt: string;
  error?: string;
};

function now() {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function safeEnv(name: string) {
  const globalWithProcess = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } };
  return globalWithProcess.process?.env?.[name] || "";
}

function extractJsonObject(text: string) {
  const trimmed = asString(text);
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveCodexPmEnvironment(env?: Record<string, string | undefined>) {
  const source = env || {
    OPENAI_API_KEY: safeEnv("OPENAI_API_KEY"),
    OPENBRANCH_PM_MODEL: safeEnv("OPENBRANCH_PM_MODEL"),
  };
  const openAiKey = asString(source.OPENAI_API_KEY);
  return {
    apiKey: openAiKey,
    apiKeySource: (openAiKey ? "OPENAI_API_KEY" : "") as CodexPmRunResult["apiKeySource"],
    model: asString(source.OPENBRANCH_PM_MODEL, DEFAULT_CODEX_PM_MODEL),
    endpoint: CODEX_PM_ENDPOINT,
  };
}

export function createFallbackPlan(context: LoopContext, reason = ""): CodexPmPlan {
  const behavior = asString(context.behavior, "OpenBranch should show the requested behavior and record verifier evidence.");
  const goal = asString(context.goal, "Build the requested OpenBranch improvement.");
  return {
    reframedGoal: goal,
    developmentPlan: [
      "Keep the user goal visible as the source of truth.",
      "Prepare a Kiro build task around the behavior Kane will verify.",
      "Run Kane or ingest real Kane evidence before accepting the branch.",
    ],
    acceptanceCriteria: [
      behavior,
      "Story View distinguishes real API execution from fallback mode.",
      "Technical Details include PM, Kiro, and Kane execution artifacts.",
    ],
    kiroBuildTask: [
      "# Kiro Builder Task",
      "",
      goal,
      "",
      "## Branch",
      "",
      "`" + context.branch + "`",
      "",
      "## Behavior Kane Will Verify",
      "",
      behavior,
    ].join("\n"),
    kaneVerificationTask: [
      "# Kane Verification Task",
      "",
      behavior,
      "",
      "Return pass/fail evidence that OpenBranch can ingest into Story View.",
    ].join("\n"),
    nextActionAfterKaneFeedback: "Use Kane evidence to accept the lesson or create the next Kiro fix branch.",
    acceptedLesson: "OpenBranch should only accept the lesson when verifier evidence supports it.",
    featureTitle: asString(context.featureTitle, "OpenBranch development loop"),
    fallbackReason: reason || "Codex PM API did not run.",
  };
}

export function normalizeCodexPmPlan(value: unknown, context: LoopContext, reason = ""): CodexPmPlan {
  const record = isRecord(value) ? value : {};
  const fallback = createFallbackPlan(context, reason);
  const developmentPlan = asStringArray(record.developmentPlan);
  const acceptanceCriteria = asStringArray(record.acceptanceCriteria);
  return {
    reframedGoal: asString(record.reframedGoal, fallback.reframedGoal),
    developmentPlan: developmentPlan.length ? developmentPlan : fallback.developmentPlan,
    acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : fallback.acceptanceCriteria,
    kiroBuildTask: asString(record.kiroBuildTask, fallback.kiroBuildTask),
    kaneVerificationTask: asString(record.kaneVerificationTask, fallback.kaneVerificationTask),
    nextActionAfterKaneFeedback: asString(record.nextActionAfterKaneFeedback, fallback.nextActionAfterKaneFeedback),
    acceptedLesson: asString(record.acceptedLesson, fallback.acceptedLesson),
    featureTitle: asString(record.featureTitle, fallback.featureTitle),
    fallbackReason: asString(record.fallbackReason, fallback.fallbackReason),
  };
}

export function createCodexPmPrompt(
  context: LoopContext,
  options: { mode?: string; capabilitySummary?: string; kaneFeedback?: string; previousPlan?: CodexPmPlan } = {},
) {
  return [
    "You are Codex PM, the goal keeper for OpenBranch for AI Development.",
    "",
    "Roles:",
    "- Codex = PM / goal keeper",
    "- Kiro = Builder",
    "- Kane = Verifier",
    "- OpenBranch = Control Tower + Story Layer",
    "",
    "Return only valid JSON with these fields:",
    "reframedGoal, developmentPlan, acceptanceCriteria, kiroBuildTask, kaneVerificationTask, nextActionAfterKaneFeedback, acceptedLesson, featureTitle.",
    "",
    "Mode: " + (options.mode || "initial"),
    "Goal: " + context.goal,
    "Feature title: " + context.featureTitle,
    "Feature key: " + context.featureKey,
    "Branch: " + context.branch,
    "Behavior Kane should verify: " + context.behavior,
    options.capabilitySummary ? "\nCapability summary:\n" + options.capabilitySummary : "",
    options.previousPlan ? "\nPrevious PM plan:\n" + JSON.stringify(options.previousPlan, null, 2) : "",
    options.kaneFeedback ? "\nKane feedback:\n" + options.kaneFeedback : "",
  ].filter(Boolean).join("\n");
}

function extractOpenAiText(responseBody: unknown) {
  if (!isRecord(responseBody)) return "";
  if (typeof responseBody.output_text === "string") return responseBody.output_text;
  const output = Array.isArray(responseBody.output) ? responseBody.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string") chunks.push(part.text);
      if (typeof part.output_text === "string") chunks.push(part.output_text);
    }
  }
  return chunks.join("\n").trim();
}

export async function runRealCodexPm(
  context: LoopContext,
  options: { mode?: string; env?: Record<string, string | undefined>; timeoutMs?: number; capabilitySummary?: string; kaneFeedback?: string; previousPlan?: CodexPmPlan } = {},
): Promise<CodexPmRunResult> {
  const env = resolveCodexPmEnvironment(options.env);
  const prompt = createCodexPmPrompt(context, options);
  const startedAt = now();
  if (!env.apiKey) {
    return {
      apiExecuted: false,
      mode: "fallback",
      model: env.model,
      apiKeySource: "",
      prompt,
      plan: createFallbackPlan(context, "OPENAI_API_KEY is not set."),
      rawText: "",
      responseStatus: null,
      startedAt,
      endedAt: now(),
      error: "OPENAI_API_KEY is not set.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 60_000);
  try {
    const response = await fetch(env.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.apiKey,
      },
      body: JSON.stringify({
        model: env.model,
        input: prompt,
        store: false,
        max_output_tokens: 1800,
      }),
    });
    const rawBody = await response.text();
    const body = rawBody ? JSON.parse(rawBody) : null;
    if (!response.ok) {
      throw new Error(isRecord(body?.error) ? asString(body.error.message, rawBody) : rawBody);
    }
    const rawText = extractOpenAiText(body);
    const parsed = extractJsonObject(rawText);
    return {
      apiExecuted: true,
      mode: "api",
      model: env.model,
      apiKeySource: env.apiKeySource,
      prompt,
      plan: normalizeCodexPmPlan(parsed, context, "OpenAI response was not complete JSON; fallback fields filled missing values."),
      rawText,
      responseStatus: response.status,
      responseId: asString(body?.id),
      startedAt,
      endedAt: now(),
      error: parsed ? "" : "OpenAI response required fallback parsing for missing JSON fields.",
    };
  } catch (error) {
    return {
      apiExecuted: false,
      mode: "fallback",
      model: env.model,
      apiKeySource: env.apiKeySource,
      prompt,
      plan: createFallbackPlan(context, error instanceof Error ? error.message : String(error)),
      rawText: "",
      responseStatus: null,
      startedAt,
      endedAt: now(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function codexGoalArtifact(context: LoopContext, plan: CodexPmPlan, fallback = true): LoopArtifact {
  const content = [
    "/goal " + plan.reframedGoal,
    "",
    fallback ? "Codex PM fallback mode: no OpenAI API execution is attached to this handoff." : "Codex PM API generated this plan.",
    "",
    "## Development Plan",
    "",
    ...plan.developmentPlan.map((step, index) => String(index + 1) + ". " + step),
    "",
    "## Acceptance Criteria",
    "",
    ...plan.acceptanceCriteria.map((criterion) => "- " + criterion),
    "",
    "## Kiro Build Task",
    "",
    plan.kiroBuildTask,
    "",
    "## Kane Verification Task",
    "",
    plan.kaneVerificationTask,
    "",
    "## Next Action After Kane Feedback",
    "",
    plan.nextActionAfterKaneFeedback,
    "",
    "Branch: `" + context.branch + "`",
  ].join("\n");
  return {
    path: ".tmp/codex-goal.md",
    filename: "codex-goal.md",
    mime: "text/markdown",
    content,
  };
}

export function createGoal(context: LoopContext): LoopStepResult {
  const plan = createFallbackPlan(context, "Browser-side control tower cannot call OpenAI directly; run `npm run openbranch:real-loop` or `npm run codex:test` for API execution.");
  return {
    label: "Codex PM fallback mode",
    summary: "OpenBranch produced a Codex PM handoff file without claiming API execution.",
    artifacts: [codexGoalArtifact(context, plan, true)],
    commands: [
      { label: "Real Codex PM test", command: "npm run codex:test" },
      { label: "Real loop", command: "npm run openbranch:real-loop" },
    ],
  };
}

export function runBuild(context: LoopContext): LoopStepResult {
  return {
    label: "Codex/Kiro fix attempted",
    summary: "Use `.tmp/codex-goal.md` and `.tmp/kiro-next-action.md` to patch `" + context.branch + "`.",
    commands: [{ label: "Codex fix handoff", command: "codex < .tmp/kiro-next-action.md" }],
  };
}

export function runVerification(context: LoopContext): LoopStepResult {
  const event: CommonDevelopmentEvent = {
    id: "control_codex_verify_" + Date.now().toString(36),
    timestamp: now(),
    source: "codex",
    type: "verify",
    status: "verifying",
    label: "Codex PM requests Kane verification: " + context.featureTitle,
    parentId: null,
    branchId: context.branch,
    summary: "Codex hands the latest fix back to Kane through the file bridge.",
    detail: ["Expected Kane output: .tmp/kane-result.json", "Behavior to verify: " + context.behavior],
    intent: context.featureKey,
    metadata: { controlTowerStep: true, featureKey: context.featureKey, featureTitle: context.featureTitle },
  };
  return {
    label: "Codex verification handoff",
    summary: "Codex delegates browser verification to Kane and OpenBranch ingests the result.",
    commands: [{ label: "Kane Power command", command: "kane-cli run \"" + context.behavior.replace(/"/g, "'") + "\" --agent --headless --timeout 120 > .tmp/kane-result.json" }],
    events: [event],
  };
}

export function ingestResult(context: LoopContext, result: Record<string, unknown>): LoopStepResult {
  const passed = result.success === true || result.status === "passed";
  const failure = typeof result.failure === "string" ? result.failure : "Review `.tmp/kane-result.json` for the failure details.";
  return {
    label: "Codex PM ingested Kane result",
    summary: passed
      ? "Kane passed; Codex PM can accept the verified lesson."
      : "Kane failed; Codex PM should generate the next action for `" + context.branch + "`. " + failure,
  };
}

export function generateNextAction(context: LoopContext, instruction: string): LoopStepResult {
  const content = [
    "# Codex PM Debug Instruction",
    "",
    instruction,
    "",
    "Branch: `" + context.branch + "`",
    "Behavior: " + context.behavior,
  ].join("\n");
  return {
    label: "Generate Codex PM Next Action",
    summary: "OpenBranch generated a repair instruction Codex PM can hand to Kiro.",
    artifacts: [{ path: ".tmp/codex-goal.md", filename: "codex-goal.md", mime: "text/markdown", content }],
  };
}
