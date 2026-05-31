import fs from "node:fs";
import path from "node:path";

export const DEFAULT_PM_MODEL = "gpt-5.2";
export const PM_ENV_KEYS = ["OPENAI_API_KEY", "OPENBRANCH_PM_MODEL"];

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}

function truncate(value, limit = 1200) {
  const text = asString(value);
  return text.length > limit ? text.slice(0, limit - 1) + "..." : text;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;
  let value = match[2] || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key: match[1], value };
}

export function loadCodexPmEnvFiles(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const files = [
    options.envFile,
    process.env.OPENBRANCH_ENV_FILE,
    path.join(rootDir, ".env.local"),
    path.join(rootDir, ".env"),
  ].filter(Boolean);
  const loaded = [];
  for (const file of files) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) continue;
    const text = fs.readFileSync(resolved, "utf8");
    const keys = [];
    for (const line of text.split(/\r?\n/)) {
      const row = parseEnvLine(line);
      if (!row || !PM_ENV_KEYS.includes(row.key)) continue;
      if (!process.env[row.key]) process.env[row.key] = row.value;
      keys.push(row.key);
    }
    if (keys.length) loaded.push({ file: resolved, keys });
  }
  return loaded;
}

function extractJsonObject(text) {
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

export function resolveCodexPmEnvironment(env = process.env) {
  const openAiKey = asString(env.OPENAI_API_KEY);
  return {
    apiKey: openAiKey,
    apiKeySource: openAiKey ? "OPENAI_API_KEY" : "",
    model: asString(env.OPENBRANCH_PM_MODEL, DEFAULT_PM_MODEL),
    endpoint: "https://api.openai.com/v1/responses",
  };
}

export function fallbackCodexPmPlan(context, reason = "") {
  const behavior = asString(context.behavior, "OpenBranch should show the requested behavior and record verifier evidence.");
  const goal = asString(context.goal, "Build the requested OpenBranch improvement.");
  const featureTitle = asString(context.featureTitle, "OpenBranch development loop");
  return {
    reframedGoal: goal,
    developmentPlan: [
      "Keep the requested outcome visible as the source of truth.",
      "Prepare the Kiro builder task with the behavior Kane will verify.",
      "Run Kane or ingest real Kane evidence, then record the result in Story View.",
      "Accept only when the verification evidence supports the branch.",
    ],
    acceptanceCriteria: [
      behavior,
      "Story View distinguishes real execution from fallback or handoff mode.",
      "Technical Details link to the relevant run logs and generated tasks.",
    ],
    kiroBuildTask: [
      "# Kiro Builder Task",
      "",
      goal,
      "",
      "## Branch",
      "",
      "`" + asString(context.branch, "feature/openbranch-loop") + "`",
      "",
      "## Build Scope",
      "",
      "Prepare or implement the work needed for Kane to verify this behavior:",
      "",
      behavior,
      "",
      "Do not claim implementation unless the Kiro run log or diff proves it.",
    ].join("\n"),
    kaneVerificationTask: [
      "# Kane Verification Task",
      "",
      "Verify this behavior with Kane CLI when available:",
      "",
      behavior,
      "",
      "Return pass/fail evidence that OpenBranch can ingest into `events.jsonl`.",
    ].join("\n"),
    nextActionAfterKaneFeedback: "Use Kane evidence to either accept the lesson or create the next Kiro fix branch.",
    acceptedLesson: "OpenBranch records the loop only when execution evidence supports the story.",
    fallbackReason: reason || "Codex PM API did not run.",
    featureTitle,
  };
}

export function normalizeCodexPmPlan(value, context, reason = "") {
  const record = isRecord(value) ? value : {};
  const fallback = fallbackCodexPmPlan(context, reason);
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
    fallbackReason: asString(record.fallbackReason, fallback.fallbackReason),
    featureTitle: asString(record.featureTitle, fallback.featureTitle),
  };
}

export function buildCodexPmPrompt(context, options = {}) {
  const mode = options.mode || "initial";
  const kaneFeedback = options.kaneFeedback || "";
  const previousPlan = options.previousPlan;
  const capabilitySummary = options.capabilitySummary || "";
  return [
    "You are Codex PM, the goal keeper for OpenBranch for AI Development.",
    "",
    "OpenBranch architecture:",
    "- Codex = PM / goal keeper",
    "- Kiro = Builder",
    "- Kane = Verifier",
    "- OpenBranch = Control Tower + Story Layer",
    "",
    "Your job is to turn the user's goal into concrete work for Kiro and Kane.",
    "Return only valid JSON with this exact shape:",
    "{",
    '  "reframedGoal": "short goal in product language",',
    '  "developmentPlan": ["step 1", "step 2", "step 3"],',
    '  "acceptanceCriteria": ["criterion 1", "criterion 2"],',
    '  "kiroBuildTask": "markdown task Kiro can consume",',
    '  "kaneVerificationTask": "markdown task Kane can verify",',
    '  "nextActionAfterKaneFeedback": "what the team should do after Kane feedback",',
    '  "acceptedLesson": "what OpenBranch should record if verification passes",',
    '  "featureTitle": "short title"',
    "}",
    "",
    "Mode: " + mode,
    "Goal: " + asString(context.goal),
    "Feature title: " + asString(context.featureTitle),
    "Feature key: " + asString(context.featureKey),
    "Branch: " + asString(context.branch),
    "Behavior Kane should verify: " + asString(context.behavior),
    capabilitySummary ? "\nCapability summary:\n" + capabilitySummary : "",
    previousPlan ? "\nPrevious PM plan:\n" + JSON.stringify(previousPlan, null, 2) : "",
    kaneFeedback ? "\nKane feedback:\n" + kaneFeedback : "",
  ].filter(Boolean).join("\n");
}

export function extractOpenAiText(responseBody) {
  if (!isRecord(responseBody)) return "";
  if (typeof responseBody.output_text === "string") return responseBody.output_text;
  const output = Array.isArray(responseBody.output) ? responseBody.output : [];
  const chunks = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (typeof item.content === "string") chunks.push(item.content);
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (typeof part.text === "string") chunks.push(part.text);
      if (typeof part.output_text === "string") chunks.push(part.output_text);
    }
  }
  return chunks.join("\n").trim();
}

async function callResponsesApi(prompt, env, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    let body = null;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {}
    if (!response.ok) {
      const message = isRecord(body?.error) ? asString(body.error.message, rawBody) : rawBody;
      const error = new Error(message || "OpenAI Responses API request failed.");
      error.status = response.status;
      error.responseBody = body || rawBody;
      throw error;
    }
    return { status: response.status, body, rawBody, text: extractOpenAiText(body) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runCodexPm(context, options = {}) {
  const env = resolveCodexPmEnvironment(options.env || process.env);
  const prompt = buildCodexPmPrompt(context, options);
  const startedAt = new Date();
  const timeoutMs = options.timeoutMs || 60_000;

  if (!env.apiKey) {
    const plan = fallbackCodexPmPlan(context, "OPENAI_API_KEY is not set.");
    return {
      apiExecuted: false,
      mode: "fallback",
      model: env.model,
      apiKeySource: "",
      prompt,
      plan,
      rawText: "",
      responseStatus: null,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      error: "OPENAI_API_KEY is not set.",
    };
  }

  try {
    const api = await callResponsesApi(prompt, env, timeoutMs);
    const parsed = extractJsonObject(api.text);
    const plan = normalizeCodexPmPlan(parsed, context, "OpenAI response was not complete JSON; fallback fields filled missing values.");
    return {
      apiExecuted: true,
      mode: "api",
      model: env.model,
      apiKeySource: env.apiKeySource,
      prompt,
      plan,
      rawText: api.text,
      responseStatus: api.status,
      responseId: api.body?.id || "",
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      error: parsed ? "" : "OpenAI response required fallback parsing for missing JSON fields.",
    };
  } catch (error) {
    const plan = fallbackCodexPmPlan(context, error?.message || "OpenAI Responses API request failed.");
    return {
      apiExecuted: false,
      mode: "fallback",
      model: env.model,
      apiKeySource: env.apiKeySource,
      prompt,
      plan,
      rawText: "",
      responseStatus: typeof error?.status === "number" ? error.status : null,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      error: error?.message || String(error),
    };
  }
}

export function codexRunLogEntry(result, label = "Codex PM run") {
  return {
    label,
    timestamp: result.endedAt || new Date().toISOString(),
    startedAt: result.startedAt || "",
    endedAt: result.endedAt || "",
    mode: result.mode,
    apiExecuted: result.apiExecuted,
    model: result.model,
    apiKeySource: result.apiKeySource || "",
    responseStatus: result.responseStatus,
    responseId: result.responseId || "",
    apiKeyPresent: Boolean(result.apiKeySource),
    envFilesLoaded: Array.isArray(result.envFilesLoaded) ? result.envFilesLoaded : [],
    prompt: result.prompt,
    pmPlanGenerated: result.plan,
    rawText: truncate(result.rawText, 5000),
    error: result.error || "",
  };
}

export function writeCodexRunLog(file, entries) {
  const rows = Array.isArray(entries) ? entries : [entries];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ runs: rows }, null, 2));
}
