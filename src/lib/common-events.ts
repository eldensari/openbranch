import type {
  CommonDevelopmentEvent,
  Commit,
  CommitActivity,
  SemanticDevelopmentEventType,
} from "@/types";

export const LIVE_EVENTS_URL = "/events.jsonl";

export type DevelopmentGraphView = "story" | "raw";

const SOURCE_LABEL: Record<CommonDevelopmentEvent["source"], string> = {
  user: "User",
  codex: "Codex",
  kiro: "Kiro",
  kane: "Kane",
  agent: "Agent",
  merge: "Merge",
  system: "System",
};

const SEMANTIC_TYPE_LABEL: Record<SemanticDevelopmentEventType, string> = {
  session: "Session",
  goal: "Goal",
  plan: "Plan",
  spec: "Spec",
  task: "Task",
  feature_branch: "Feature Branch",
  episode: "Episode",
  build_attempt: "Build Attempt",
  verify: "Verify",
  fail: "Fail",
  pass: "Pass",
  fix_branch: "Fix Branch",
  merge: "Merge",
};

const SEMANTIC_STATUS: Record<SemanticDevelopmentEventType, string> = {
  session: "active",
  goal: "goal",
  plan: "planned",
  spec: "specified",
  task: "tasked",
  feature_branch: "branching",
  episode: "building",
  build_attempt: "building",
  verify: "verifying",
  fail: "failed",
  pass: "passed",
  fix_branch: "branching",
  merge: "merged",
};

const SEMANTIC_COLORS: Record<SemanticDevelopmentEventType, string> = {
  session: "#0f766e",
  goal: "#71717a",
  plan: "#2563eb",
  spec: "#2563eb",
  task: "#2563eb",
  feature_branch: "#7c3aed",
  episode: "#2563eb",
  build_attempt: "#2563eb",
  verify: "#16a34a",
  fail: "#dc2626",
  pass: "#16a34a",
  fix_branch: "#7c3aed",
  merge: "#d97706",
};

const FILE_GROUP_GAP_MS = 45_000;
const FILE_GROUP_SPAN_MS = 180_000;

const VALID_SOURCES = new Set<CommonDevelopmentEvent["source"]>([
  "user",
  "codex",
  "kiro",
  "kane",
  "agent",
  "merge",
  "system",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeSource(value: unknown, fallback: CommonDevelopmentEvent["source"] = "agent") {
  const source = asString(value).toLowerCase();
  return VALID_SOURCES.has(source as CommonDevelopmentEvent["source"])
    ? (source as CommonDevelopmentEvent["source"])
    : fallback;
}

function toArrayOfStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.map((item) => asString(item)).filter(Boolean);
  return strings.length ? strings : undefined;
}

function normalizeSemanticType(type?: string, status?: string): SemanticDevelopmentEventType | null {
  const key = (type || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const statusKey = (status || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const direct: Record<string, SemanticDevelopmentEventType> = {
    session: "session",
    development_session: "session",
    user_goal: "goal",
    goal: "goal",
    kiro_plan: "plan",
    plan: "plan",
    planned: "plan",
    kiro_spec: "spec",
    spec: "spec",
    specification: "spec",
    kiro_task: "task",
    task: "task",
    feature: "feature_branch",
    feature_branch: "feature_branch",
    ai_feature_branch: "feature_branch",
    episode: "episode",
    development_episode: "episode",
    build: "build_attempt",
    build_attempt: "build_attempt",
    kiro_build: "build_attempt",
    kiro_build_attempt: "build_attempt",
    verify: "verify",
    verification: "verify",
    verification_started: "verify",
    kane_verification_started: "verify",
    kane_verify: "verify",
    fail: "fail",
    failed: "fail",
    failure: "fail",
    verification_failed: "fail",
    bug_found: "fail",
    kane_bug_found: "fail",
    kane_fail: "fail",
    kane_failure: "fail",
    pass: "pass",
    passed: "pass",
    success: "pass",
    verification_passed: "pass",
    reverification_passed: "pass",
    re_verification_passed: "pass",
    kane_pass: "pass",
    fix: "fix_branch",
    branch: "fix_branch",
    fix_branch: "fix_branch",
    ai_fix_branch: "fix_branch",
    merge: "merge",
    merged: "merge",
    merge_to_main: "merge",
  };

  return direct[key] || direct[statusKey] || null;
}

function semanticSourceFor(
  type: SemanticDevelopmentEventType,
  currentSource: CommonDevelopmentEvent["source"],
): CommonDevelopmentEvent["source"] {
  if (currentSource !== "agent" && currentSource !== "system") return currentSource;
  if (type === "session") return "system";
  if (type === "goal") return "user";
  if (type === "episode") return "agent";
  if (type === "plan" || type === "spec" || type === "task" || type === "build_attempt") return "kiro";
  if (type === "feature_branch") return "agent";
  if (type === "verify" || type === "fail" || type === "pass") return "kane";
  if (type === "merge") return "merge";
  return "agent";
}

function isFileEvent(event: CommonDevelopmentEvent) {
  const status = event.status.toLowerCase();
  return (
    event.type.startsWith("file.") ||
    event.type.startsWith("file_") ||
    ((status === "created" || status === "modified" || status === "deleted") && !!filePathFromEvent(event)) ||
    /^(?:Created|Modified|Deleted)\s+(.+)$/i.test(event.label)
  );
}

function filePathFromEvent(event: CommonDevelopmentEvent) {
  if (event.files?.[0]) return event.files[0];
  const metadataPath = event.metadata?.path;
  if (typeof metadataPath === "string" && metadataPath) return metadataPath;
  const match = event.label.match(/^(?:Created|Modified|Deleted)\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function shouldIgnoreFilePath(filePath: string) {
  if (!filePath) return true;
  const parts = filePath.replace(/\\/g, "/").split("/");
  const base = parts[parts.length - 1] || "";
  return (
    parts.some((part) => [".git", ".vite", ".idea", ".claude", "node_modules", "dist", "build"].includes(part)) ||
    base === "events.jsonl" ||
    base.endsWith(".log") ||
    base.endsWith(".err") ||
    base.endsWith(".out") ||
    base.endsWith(".tmp") ||
    base === "Thumbs.db" ||
    base === ".DS_Store"
  );
}

function shouldSkipEvent(event: CommonDevelopmentEvent) {
  return isFileEvent(event) && shouldIgnoreFilePath(filePathFromEvent(event));
}

function normalizeInputEvent(row: unknown): CommonDevelopmentEvent | null {
  if (!isRecord(row)) return null;
  const id = asString(row.id);
  if (!id) return null;

  const type = asString(row.type, asString(row.kind, "event"));
  const semanticType = normalizeSemanticType(type, asString(row.status));
  const status = asString(row.status, semanticType ? SEMANTIC_STATUS[semanticType] : "updated");
  const title = asString(row.title);
  const label = asString(row.label, title || SEMANTIC_TYPE_LABEL[semanticType || "task"] || type);
  const source = normalizeSource(row.source, semanticType ? semanticSourceFor(semanticType, "agent") : "agent");
  const branchId = asString(row.branchId, asString(row.branch, "main"));
  const rawParent = row.parentId;
  const metadata = isRecord(row.metadata) ? row.metadata : undefined;
  const files = toArrayOfStrings(row.files);
  const detail = toArrayOfStrings(row.detail);
  const rawEventIds = toArrayOfStrings(row.rawEventIds);
  const mergeParentIds = toArrayOfStrings(row.mergeParentIds);
  const confidence = typeof row.confidence === "number" ? row.confidence : undefined;

  return {
    id,
    timestamp: asString(row.timestamp, asString(row.at, new Date().toISOString())),
    source,
    type,
    status,
    label,
    parentId: rawParent === null ? null : asString(rawParent, null as unknown as string),
    branchId,
    summary: asString(row.summary, undefined as unknown as string),
    detail,
    files,
    rawEventIds,
    mergeParentIds,
    intent: asString(row.intent, undefined as unknown as string),
    confidence,
    metadata,
  };
}

export function parseEventsJsonl(text: string): CommonDevelopmentEvent[] {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeInputEvent(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((event): event is CommonDevelopmentEvent => !!event);
}

function tsFor(event: CommonDevelopmentEvent, fallback: number) {
  const ts = Date.parse(event.timestamp);
  return Number.isFinite(ts) ? ts : fallback;
}

function shiftedIso(timestamp: string, deltaMs: number) {
  const ts = Date.parse(timestamp);
  return new Date((Number.isFinite(ts) ? ts : Date.now()) + deltaMs).toISOString();
}

function stableHash(parts: Array<string | number | null | undefined>) {
  const input = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function semanticId(type: SemanticDevelopmentEventType | string, parts: Array<string | number | null | undefined>) {
  return "sem_" + type + "_" + stableHash(parts);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "development";
}

function splitWords(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b(page|panel|view|component|screen)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function inferIntent(files: string[], rawEvents: CommonDevelopmentEvent[]) {
  const joined = files.join(" ").toLowerCase();
  const hasLogin = /\b(log[\s-]?in|signin|sign-in|signup|sign-up)\b/.test(joined);
  const hasAuth = /\b(auth|session|oauth|token|password|credential)\b/.test(joined);
  const hasGraph = /\b(graph|branch|node|edge)\b/.test(joined);
  const hasSemanticEvents = /\b(common-events|development-events|development-event-adapter|events\.jsonl|semantic)\b/.test(joined);
  const hasUi = /\b(app|chatpanel|sidebar|component|ui|tsx|jsx)\b/.test(joined);
  const hasVerify = /\b(test|spec|verify|check|playwright|vitest|jest|cypress)\b/.test(joined);
  const hasConfig = /\b(package\.json|vite\.config|tsconfig|netlify\.toml|config)\b/.test(joined);
  const hasStyle = /\b(css|tailwind|theme|style)\b/.test(joined);
  const hasDocs = /\b(readme|docs?|markdown|\.md)\b/.test(joined);
  const hasStorage = /\b(storage|localstorage|database|db|neo4j)\b/.test(joined);
  const hasApi = /\b(api|function|netlify|server|llm|chat\.js)\b/.test(joined);

  if (hasLogin && hasAuth && files.length > 1) {
    return { key: "auth-flow", title: "Build authentication flow" };
  }
  if (hasLogin) return { key: "login-ui", title: "Build Login UI" };
  if (hasAuth) return { key: "auth-logic", title: "Update authentication logic" };
  if (hasSemanticEvents || (hasGraph && hasUi)) {
    return { key: "semantic-development-events", title: "Build Semantic Development Events" };
  }
  if (hasGraph) return { key: "graph", title: "Update graph visualization" };
  if (hasVerify) return { key: "verification", title: "Update verification coverage" };
  if (hasStorage) return { key: "storage", title: "Update persistence logic" };
  if (hasApi) return { key: "api", title: "Update backend API" };
  if (hasStyle) return { key: "style", title: "Update visual styling" };
  if (hasDocs) return { key: "docs", title: "Update project documentation" };
  if (hasConfig) return { key: "config", title: "Update project configuration" };
  if (files.length > 1) return { key: "feature", title: "Build application feature" };

  const file = files[0] || filePathFromEvent(rawEvents[0]) || "application";
  const base = file.split(/[\\/]/).pop() || file;
  const words = titleCase(splitWords(base));
  if (/\.(tsx|jsx)$/.test(base)) return { key: slugify(base), title: "Build " + (words || "Component") + " UI" };
  if (/\.(ts|js|mjs|cjs)$/.test(base)) return { key: slugify(base), title: "Update " + (words || "application") + " logic" };
  return { key: slugify(base), title: "Update " + (words || "project file") };
}

function uniqueFiles(events: CommonDevelopmentEvent[]) {
  const seen = new Set<string>();
  for (const event of events) {
    const file = filePathFromEvent(event);
    if (file) seen.add(file);
  }
  return [...seen];
}

function canJoinFileGroup(group: CommonDevelopmentEvent[], event: CommonDevelopmentEvent) {
  if (!group.length) return true;
  const first = group[0];
  const last = group[group.length - 1];
  const eventTs = tsFor(event, Date.now());
  const lastTs = tsFor(last, eventTs);
  const firstTs = tsFor(first, eventTs);
  return (
    event.branchId === first.branchId &&
    eventTs - lastTs <= FILE_GROUP_GAP_MS &&
    eventTs - firstTs <= FILE_GROUP_SPAN_MS
  );
}

function makeSemanticEvent(args: {
  type: SemanticDevelopmentEventType;
  id: string;
  timestamp: string;
  source?: CommonDevelopmentEvent["source"];
  label: string;
  summary: string;
  parentId: string | null;
  branchId: string;
  files?: string[];
  rawEventIds?: string[];
  mergeParentIds?: string[];
  detail?: string[];
  intent?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}): CommonDevelopmentEvent {
  const source = args.source || semanticSourceFor(args.type, "agent");
  return {
    id: args.id,
    timestamp: args.timestamp,
    source,
    type: args.type,
    status: SEMANTIC_STATUS[args.type],
    label: args.label,
    parentId: args.parentId,
    branchId: args.branchId,
    summary: args.summary,
    detail: args.detail,
    files: args.files,
    rawEventIds: args.rawEventIds,
    mergeParentIds: args.mergeParentIds,
    intent: args.intent,
    confidence: args.confidence,
    metadata: args.metadata,
  };
}

function rawEventSummary(event: CommonDevelopmentEvent) {
  return {
    id: event.id,
    timestamp: event.timestamp,
    source: event.source,
    type: event.type,
    status: event.status,
    label: event.label,
    branchId: event.branchId,
    files: event.files,
  };
}

function normalizeSemanticEvent(event: CommonDevelopmentEvent, fallbackParentId: string | null): CommonDevelopmentEvent | null {
  const type = normalizeSemanticType(event.type, event.status);
  if (!type) return null;
  const source = semanticSourceFor(type, event.source);
  return {
    ...event,
    type,
    status: SEMANTIC_STATUS[type],
    source,
    label: event.label || SEMANTIC_TYPE_LABEL[type],
    parentId: event.parentId ?? fallbackParentId,
    summary: event.summary || event.detail?.join(" "),
  };
}

function fileGroupToBuildEvent(
  group: CommonDevelopmentEvent[],
  parentId: string | null,
  branchId: string,
): CommonDevelopmentEvent {
  const files = uniqueFiles(group);
  const intent = inferIntent(files, group);
  const rawEventIds = group.map((event) => event.id);
  const edited = group.filter((event) => event.status === "modified").length;
  const created = group.filter((event) => event.status === "created").length;
  const deleted = group.filter((event) => event.status === "deleted").length;
  const detail = [
    edited ? edited + " modified" : "",
    created ? created + " created" : "",
    deleted ? deleted + " deleted" : "",
  ].filter(Boolean);
  const changeSummary = detail.length ? detail.join(", ") : group.length + " file event" + (group.length === 1 ? "" : "s");

  return makeSemanticEvent({
    type: "build_attempt",
    id: semanticId("build", rawEventIds),
    timestamp: group[0]?.timestamp || new Date().toISOString(),
    source: "kiro",
    label: intent.title,
    summary: "Grouped " + group.length + " low-level file event" + (group.length === 1 ? "" : "s") + " into one build attempt (" + changeSummary + ").",
    parentId,
    branchId,
    files,
    rawEventIds,
    detail: files.map((file) => "Changed " + file),
    intent: intent.key,
    confidence: files.length > 1 ? 0.82 : 0.72,
    metadata: {
      rawEvents: group.map(rawEventSummary),
      changeSummary,
    },
  });
}

function semanticEventType(event?: CommonDevelopmentEvent | null) {
  return event ? normalizeSemanticType(event.type, event.status) : null;
}

function appendStoryOpeners(
  output: CommonDevelopmentEvent[],
  firstEvent: CommonDevelopmentEvent,
  branchId: string,
) {
  const seed = firstEvent.id || firstEvent.timestamp;
  const goal = makeSemanticEvent({
    type: "goal",
    id: semanticId("goal", [seed]),
    timestamp: shiftedIso(firstEvent.timestamp, -4000),
    source: "user",
    label: "Goal: Track AI development history",
    summary: "Show the development story behind an AI build, not just the file history.",
    parentId: null,
    branchId,
  });
  const plan = makeSemanticEvent({
    type: "plan",
    id: semanticId("plan", [seed]),
    timestamp: shiftedIso(firstEvent.timestamp, -3000),
    source: "kiro",
    label: "Plan semantic development events",
    summary: "Transform raw file watcher output into high-level development events for the OpenBranch graph.",
    parentId: goal.id,
    branchId,
  });
  const spec = makeSemanticEvent({
    type: "spec",
    id: semanticId("spec", [seed]),
    timestamp: shiftedIso(firstEvent.timestamp, -2000),
    source: "kiro",
    label: "Spec event schema",
    summary: "Use Goal, Plan, Spec, Task, Build Attempt, Verify, Fail, Pass, Fix Branch, and Merge nodes.",
    parentId: plan.id,
    branchId,
  });
  const task = makeSemanticEvent({
    type: "task",
    id: semanticId("task", [seed]),
    timestamp: shiftedIso(firstEvent.timestamp, -1000),
    source: "kiro",
    label: "Task semantic adapter",
    summary: "Group related file changes into build attempts and surround them with verification story nodes.",
    parentId: spec.id,
    branchId,
  });
  output.push(goal, plan, spec, task);
}

export function commonEventsToSemanticEvents(events: CommonDevelopmentEvent[]): CommonDevelopmentEvent[] {
  const sorted = events
    .filter((event) => !shouldSkipEvent(event))
    .slice()
    .sort((a, b) => tsFor(a, 0) - tsFor(b, 0));
  const items: Array<CommonDevelopmentEvent | CommonDevelopmentEvent[]> = [];
  let group: CommonDevelopmentEvent[] = [];
  const flushGroup = () => {
    if (group.length) items.push(group);
    group = [];
  };

  for (const event of sorted) {
    const explicitSemantic = semanticEventType(event) && !isFileEvent(event);
    if (isFileEvent(event) && !explicitSemantic) {
      if (!canJoinFileGroup(group, event)) flushGroup();
      group.push(event);
      continue;
    }
    flushGroup();
    const normalized = normalizeSemanticEvent(event, null);
    if (normalized) items.push(normalized);
  }
  flushGroup();

  const hasFileGroups = items.some((item) => Array.isArray(item));
  const hasStoryOpeners = items.some((item) => {
    if (Array.isArray(item)) return false;
    const type = semanticEventType(item);
    return type === "goal" || type === "plan" || type === "spec" || type === "task";
  });
  const firstRaw = sorted[0];
  const output: CommonDevelopmentEvent[] = [];
  const mainBranch = firstRaw?.branchId || "main";

  if (firstRaw && hasFileGroups && !hasStoryOpeners) {
    appendStoryOpeners(output, firstRaw, mainBranch);
  }

  let parentId = output[output.length - 1]?.id || null;
  let lastFailure: CommonDevelopmentEvent | null = null;
  let activeFixBranch: string | null = null;

  const append = (event: CommonDevelopmentEvent) => {
    output.push(event);
    parentId = event.id;
    const type = semanticEventType(event);
    if (type === "fail") {
      lastFailure = event;
      activeFixBranch = null;
    } else if (type === "fix_branch") {
      activeFixBranch = event.branchId;
    } else if (type === "merge") {
      lastFailure = null;
      activeFixBranch = null;
    }
  };

  for (const item of items) {
    if (!Array.isArray(item)) {
      const knownParent = item.parentId && output.some((event) => event.id === item.parentId)
        ? item.parentId
        : parentId;
      append({ ...item, parentId: knownParent });
      continue;
    }

    const files = uniqueFiles(item);
    const intent = inferIntent(files, item);
    if (lastFailure && !activeFixBranch) {
      const fixBranch = "fix/" + slugify(intent.key);
      append(makeSemanticEvent({
        type: "fix_branch",
        id: semanticId("fix_branch", [lastFailure.id, item[0]?.id]),
        timestamp: shiftedIso(item[0]?.timestamp || lastFailure.timestamp, -500),
        source: "agent",
        label: "Open fix branch for " + intent.title.replace(/^(Build|Update)\s+/i, ""),
        summary: "A failed verification creates an isolated retry branch.",
        parentId: lastFailure.id,
        branchId: fixBranch,
        rawEventIds: item.map((event) => event.id),
        intent: intent.key,
      }));
    }

    const branchId = activeFixBranch || item[0]?.branchId || mainBranch;
    const build = fileGroupToBuildEvent(item, parentId, branchId);
    append(build);

    const verify = makeSemanticEvent({
      type: "verify",
      id: semanticId("verify", [build.id]),
      timestamp: shiftedIso(item[item.length - 1]?.timestamp || build.timestamp, 500),
      source: "kane",
      label: "Verify " + build.label.replace(/^(Build|Update)\s+/i, ""),
      summary: "Kane verifies the semantic build attempt represented by this file-change group.",
      parentId: build.id,
      branchId,
      files: build.files,
      rawEventIds: build.rawEventIds,
      intent: build.intent,
      confidence: build.confidence,
    });
    append(verify);

    const pass = makeSemanticEvent({
      type: "pass",
      id: semanticId("pass", [build.id]),
      timestamp: shiftedIso(item[item.length - 1]?.timestamp || build.timestamp, 1000),
      source: "kane",
      label: "Pass " + build.label.replace(/^(Build|Update)\s+/i, ""),
      summary: "No failure event was reported for this build attempt, so the semantic adapter marks it as passing.",
      parentId: verify.id,
      branchId,
      files: build.files,
      rawEventIds: build.rawEventIds,
      intent: build.intent,
      confidence: build.confidence,
    });
    append(pass);

    if (lastFailure && activeFixBranch) {
      append(makeSemanticEvent({
        type: "merge",
        id: semanticId("merge", [lastFailure.id, pass.id]),
        timestamp: shiftedIso(pass.timestamp, 500),
        source: "merge",
        label: "Merge successful fix to main",
        summary: "The passing fix branch merges back into main.",
        parentId: lastFailure.id,
        branchId: lastFailure.branchId || mainBranch,
        mergeParentIds: [pass.id],
        files: build.files,
        rawEventIds: build.rawEventIds,
        intent: build.intent,
      }));
    }
  }

  return output;
}

type StoryStep = {
  id: string;
  kind: CommitActivity["kind"];
  label: string;
  detail?: string;
  status: CommitActivity["status"];
  source: string;
  timestamp?: string;
};

type StoryFeatureInfo = {
  key: string;
  title: string;
  branchId: string;
};

type StoryAttempt = {
  build: CommonDevelopmentEvent;
  verify: CommonDevelopmentEvent | null;
  outcome: CommonDevelopmentEvent | null;
  feature: StoryFeatureInfo;
  fallbackBuildStep?: StoryStep;
  order: number;
};

type StoryEpisode = {
  key: string;
  title: string;
  feature: StoryFeatureInfo;
  attempts: StoryAttempt[];
  order: number;
};

type StoryIdeaProfile = {
  assumption: string;
  challenge: string;
  shift: string;
  emerged: string;
  matters: string;
  explored: string;
  learned: string;
  curiosity: string;
};

function cleanStoryTitle(label: string) {
  return label
    .replace(/^Goal:\s*/i, "")
    .replace(/^(Build|Update|Verify|Pass|Fail|Fix|Kiro)\s+/i, "")
    .trim();
}

function metadataValue(event: CommonDevelopmentEvent, keys: string[]) {
  for (const key of keys) {
    const value = event.metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function titleFromFeatureKey(key: string) {
  return titleCase(key.replace(/[-_]+/g, " "));
}

function featureScore(
  key: string,
  files: string[],
  text: string,
): { key: string; title: string; score: number } {
  const joinedFiles = files.map((file) => file.replace(/\\/g, "/")).join(" ").toLowerCase();
  const joined = (joinedFiles + " " + text.toLowerCase()).trim();

  if (key === "live-event-probe") {
    return {
      key,
      title: "Live Event Probe",
      score: /\blive-event-probe\b|live event probe|probe/.test(joined) ? 12 : 0,
    };
  }

  if (key === "semantic-development-events") {
    let score = 0;
    if (/\bsrc\/lib\/common-events\.ts\b/.test(joinedFiles)) score += 6;
    if (/\bsrc\/lib\/development-events\.ts\b/.test(joinedFiles)) score += 5;
    if (/\bsrc\/types\.ts\b/.test(joinedFiles)) score += 3;
    if (/\bsemantic|development event|event schema|adapter|events\.jsonl\b/.test(joined)) score += 3;
    return { key, title: "Semantic Development Events", score };
  }

  let score = 0;
  if (/\bsrc\/ui\/graph\.tsx\b/.test(joinedFiles)) score += 5;
  if (/\bsrc\/ui\/chatpanel\.tsx\b/.test(joinedFiles)) score += 4;
  if (/\bsrc\/app\.tsx\b/.test(joinedFiles)) score += 2;
  if (/\bstory graph|graph ui|story view|raw event view|collapse|node|branch|merge\b/.test(joined)) score += 3;
  return { key, title: "Story Graph UI", score };
}

function explicitFeatureKey(events: CommonDevelopmentEvent[]) {
  for (const event of events) {
    const explicit = metadataValue(event, ["featureKey", "featureId", "feature", "workUnit", "workUnitId"]);
    if (explicit) return slugify(explicit.replace(/^feature\//, ""));
    if (event.branchId?.startsWith("feature/")) return slugify(event.branchId.replace(/^feature\//, ""));
  }
  return "";
}

function inferFeatureInfo(
  primary: CommonDevelopmentEvent,
  related: Array<CommonDevelopmentEvent | null | undefined> = [],
  fallback?: StoryFeatureInfo | null,
): StoryFeatureInfo {
  const events = [primary, ...(related.filter(Boolean) as CommonDevelopmentEvent[])];
  const explicit = explicitFeatureKey(events);
  if (explicit) {
    return {
      key: explicit,
      title: titleFromFeatureKey(explicit),
      branchId: "feature/" + explicit,
    };
  }

  const files = Array.from(new Set(events.flatMap((event) => event.files || [])));
  const text = events
    .map((event) => [event.label, event.summary, event.intent, ...(event.detail || [])].filter(Boolean).join(" "))
    .join(" ");
  const candidates = [
    featureScore("live-event-probe", files, text),
    featureScore("semantic-development-events", files, text),
    featureScore("story-graph-ui", files, text),
  ].sort((a, b) => b.score - a.score);

  if (candidates[0]?.score > 0) {
    return {
      key: candidates[0].key,
      title: candidates[0].title,
      branchId: "feature/" + candidates[0].key,
    };
  }

  const intent = asString(primary.intent);
  const inferredKey = intent && !["feature", "graph", "style", "config", "docs", "api"].includes(intent)
    ? slugify(intent)
    : fallback?.key || slugify(cleanStoryTitle(primary.label) || "development-work");
  return {
    key: inferredKey,
    title: fallback?.key === inferredKey ? fallback.title : titleFromFeatureKey(inferredKey),
    branchId: "feature/" + inferredKey,
  };
}

function storySessionTitle(events: CommonDevelopmentEvent[]) {
  const goal = events.find((event) => semanticEventType(event) === "goal");
  const title = cleanStoryTitle(goal?.label || "Track AI development history");
  return "Session: " + (title || "Development work cycle");
}

function storyStepDetail(event: CommonDevelopmentEvent, fallback: string) {
  const lines = [event.summary || fallback];
  if (event.files?.length) lines.push("Files:\n" + event.files.map((file) => "- " + file).join("\n"));
  const rawEvents = Array.isArray(event.metadata?.rawEvents) ? event.metadata.rawEvents : [];
  if (rawEvents.length) {
    lines.push(
      "Low-level events:\n" +
        rawEvents
          .map((raw) => {
            if (!isRecord(raw)) return "";
            return "- " + asString(raw.label, asString(raw.type, "event"));
          })
          .filter(Boolean)
          .join("\n"),
    );
  } else if (event.rawEventIds?.length) {
    lines.push("Raw event IDs: " + event.rawEventIds.join(", "));
  }
  return lines.filter(Boolean).join("\n\n");
}

function stepForEvent(event: CommonDevelopmentEvent, label: string, kind: CommitActivity["kind"]): StoryStep {
  const type = semanticEventType(event);
  const failed = type === "fail" || event.status === "failed";
  return {
    id: event.id + "-story-step",
    kind: failed ? "error" : kind,
    label,
    detail: storyStepDetail(event, label),
    status: failed ? "error" : "done",
    source: event.source,
    timestamp: event.timestamp,
  };
}

function syntheticStoryStep(
  seed: CommonDevelopmentEvent,
  label: string,
  source: CommonDevelopmentEvent["source"],
  detail: string,
): StoryStep {
  return {
    id: seed.id + "-" + slugify(label) + "-story-step",
    kind: source === "kane" ? "done" : "tool",
    label,
    detail,
    status: "done",
    source,
    timestamp: seed.timestamp,
  };
}

function storyStepsForEpisode(
  build: CommonDevelopmentEvent,
  verify: CommonDevelopmentEvent | null,
  outcome: CommonDevelopmentEvent | null,
  fallbackBuild?: StoryStep,
) {
  const steps: StoryStep[] = [
    fallbackBuild || stepForEvent(build, "Development work", "tool"),
  ];
  steps.push(verify ? stepForEvent(verify, "Kane checked the work", "done") : syntheticStoryStep(build, "Kane checked the work", "kane", "Verification is represented as part of this development episode."));
  if (outcome) {
    const type = semanticEventType(outcome);
    steps.push(stepForEvent(outcome, type === "fail" ? "Kane found a problem" : "Kane cleared the episode", type === "fail" ? "error" : "done"));
  }
  return steps;
}

function outcomeForEpisode(outcome: CommonDevelopmentEvent | null) {
  const type = semanticEventType(outcome);
  if (type === "fail") return "failed";
  if (type === "pass") return "passed";
  return "building";
}

function attemptChangeSummary(build: CommonDevelopmentEvent) {
  const changeSummary = metadataValue(build, ["changeSummary"]);
  if (changeSummary) return changeSummary;
  if (build.summary) return build.summary;
  if (build.files?.length) return "Changed " + build.files.length + " file" + (build.files.length === 1 ? "" : "s");
  return "Updated the feature branch.";
}

function attemptVerificationSummary(outcome: CommonDevelopmentEvent | null) {
  const type = semanticEventType(outcome);
  const guidance = kaneGuidanceForEvent(outcome);
  if (type === "fail") {
    return guidance.failure
      ? "Kane tested " + guidance.behavior + " and found: " + guidance.failure
      : outcome?.summary || "Kane verification failed.";
  }
  if (type === "pass") {
    return guidance.evidence.length
      ? "Kane verified " + guidance.behavior + " with evidence: " + guidance.evidence[0]
      : outcome?.summary || "Kane verification passed.";
  }
  return "Verification is still in progress.";
}

function metadataString(event: CommonDevelopmentEvent | null | undefined, key: string) {
  const value = event?.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metadataStringArray(event: CommonDevelopmentEvent | null | undefined, key: string) {
  const value = event?.metadata?.[key];
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function kaneGuidanceForEvent(event: CommonDevelopmentEvent | null | undefined) {
  const detailText = (event?.detail || []).join(" ");
  const behavior = metadataString(event, "kaneBehavior") || event?.label || "this behavior";
  const failure = metadataString(event, "kaneFailure");
  const why = metadataString(event, "kaneWhyItMatters");
  const next = metadataString(event, "kiroNextAction");
  const evidence = metadataStringArray(event, "kaneEvidence");
  return {
    behavior,
    failure: failure || detailText.match(/Failure:\s*([^]+?)(?: Reason it matters:| Kiro should fix next:| Raw Kane result:|$)/)?.[1]?.trim() || "",
    why: why || detailText.match(/Reason it matters:\s*([^]+?)(?: Kiro should fix next:| Raw Kane result:|$)/)?.[1]?.trim() || "",
    next: next || detailText.match(/Kiro should fix next:\s*([^]+?)(?: Raw Kane result:|$)/)?.[1]?.trim() || "",
    evidence,
  };
}

function kaneGuidanceForAttempt(attempt: StoryAttempt | null | undefined) {
  return kaneGuidanceForEvent(attempt?.outcome || attempt?.verify);
}

function attemptTitleFor(build: CommonDevelopmentEvent, feature: StoryFeatureInfo) {
  const files = (build.files || []).map((file) => file.replace(/\\/g, "/").toLowerCase());
  const has = (pattern: RegExp) => files.some((file) => pattern.test(file));
  if (feature.key === "live-event-probe") return "add live probe";
  if (feature.key === "semantic-development-events") {
    if (has(/src\/types\.ts$/) && !has(/common-events|development-events/)) return "extend event types";
    if (has(/src\/lib\/development-events\.ts$/) && !has(/common-events/)) return "map demo events";
    if (has(/src\/lib\/common-events\.ts$/)) return "build event adapter";
    return "build semantic events";
  }
  if (feature.key === "story-graph-ui") {
    if (has(/src\/ui\/graph\.tsx$/)) return "render story graph";
    if (has(/src\/ui\/chatpanel\.tsx$/)) return "wire story controls";
    if (has(/src\/app\.tsx$/)) return "connect story mode";
    return "shape graph UI";
  }
  return cleanStoryTitle(build.label).toLowerCase() || "update feature";
}

function episodeTitleForAttempt(attempt: StoryAttempt) {
  return titleCase(attemptTitleFor(attempt.build, attempt.feature));
}

function episodeKeyForAttempt(attempt: StoryAttempt) {
  return slugify(episodeTitleForAttempt(attempt));
}

function outcomeForAttempts(attempts: StoryAttempt[]) {
  const last = attempts[attempts.length - 1];
  return outcomeForEpisode(last?.outcome || null);
}

function uniqueAttemptFiles(attempts: StoryAttempt[]) {
  const seen = new Set<string>();
  for (const attempt of attempts) {
    for (const file of attempt.build.files || []) seen.add(file);
    for (const file of attempt.verify?.files || []) seen.add(file);
    for (const file of attempt.outcome?.files || []) seen.add(file);
  }
  return [...seen];
}

function rawEventsForAttempts(attempts: StoryAttempt[]) {
  return attempts.flatMap((attempt) => {
    const rawEvents = Array.isArray(attempt.build.metadata?.rawEvents) ? attempt.build.metadata.rawEvents : [];
    return rawEvents.filter(isRecord);
  });
}

function formatOutcome(status: string) {
  if (status === "passed") return "Passed";
  if (status === "failed") return "Failed";
  return "In Progress";
}

function ordinalWord(index: number) {
  const words = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth"];
  return words[index - 1] || "Pass " + index;
}

function attemptDetail(attempt: StoryAttempt, attemptNumber: number) {
  const steps = storyStepsForEpisode(attempt.build, attempt.verify, attempt.outcome, attempt.fallbackBuildStep);
  const files = attempt.build.files || [];
  const lines = [
    ordinalWord(attemptNumber) + " development pass: " + episodeTitleForAttempt(attempt),
    "What changed: " + attemptChangeSummary(attempt.build),
    "Verification: " + attemptVerificationSummary(attempt.outcome),
    "Files changed: " + (files.length ? files.join(", ") : "No file list reported"),
    "Development arc:\n" +
      steps
        .map((step) => "- " + step.label + (step.status === "error" ? " failed" : " completed"))
        .join("\n"),
  ];
  return lines.join("\n\n");
}

function activityForAttempt(attempt: StoryAttempt, attemptNumber: number): StoryStep {
  const status = outcomeForEpisode(attempt.outcome);
  const failed = status === "failed";
  const title = episodeTitleForAttempt(attempt);
  return {
    id: attempt.build.id + "-attempt-summary",
    kind: failed ? "error" : "tool",
    label: ordinalWord(attemptNumber) + " pass through " + title + " - " + formatOutcome(status),
    detail: attemptDetail(attempt, attemptNumber),
    status: failed ? "error" : "done",
    source: attempt.build.source,
    timestamp: attempt.build.timestamp,
  };
}

function groupAttemptsIntoEpisodes(attempts: StoryAttempt[]): StoryEpisode[] {
  const episodes = new Map<string, StoryEpisode>();
  attempts
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((attempt) => {
      const title = episodeTitleForAttempt(attempt);
      const key = episodeKeyForAttempt(attempt);
      let episode = episodes.get(key);
      if (!episode) {
        episode = {
          key,
          title,
          feature: attempt.feature,
          attempts: [],
          order: attempt.order,
        };
        episodes.set(key, episode);
      }
      episode.attempts.push(attempt);
    });
  return [...episodes.values()].sort((a, b) => a.order - b.order);
}

function makeStoryEpisodeEvent(args: {
  episode: StoryEpisode;
  parentId: string | null;
  branchId: string;
}): CommonDevelopmentEvent {
  const { episode, parentId, branchId } = args;
  const attempts = episode.attempts;
  const firstAttempt = attempts[0];
  const lastAttempt = attempts[attempts.length - 1];
  const outcomeStatus = outcomeForAttempts(attempts);
  const files = uniqueAttemptFiles(attempts);
  const rawEvents = rawEventsForAttempts(attempts);
  const storySteps = attempts.map((attempt, index) => activityForAttempt(attempt, index + 1));
  const failedAttempts = attempts.filter((attempt) => outcomeForEpisode(attempt.outcome) === "failed").length;
  const verification = formatOutcome(outcomeStatus);
  const profile = ideaProfileForKey(episode.feature.key, episode.feature.title);
  const learning = branchLearningFromAttempts(attempts, profile);
  const survival = survivalForOutcome(outcomeStatus, failedAttempts);
  const kaneGuidance = kaneGuidanceForAttempt(lastAttempt);
  const kaneDetailLines = outcomeStatus === "failed"
    ? [
        "Kane tested: " + kaneGuidance.behavior,
        kaneGuidance.failure ? "Failure: " + kaneGuidance.failure : "",
        kaneGuidance.why ? "Reason it matters: " + kaneGuidance.why : "",
        kaneGuidance.next ? "Kiro should fix next: " + kaneGuidance.next : "",
      ].filter(Boolean)
    : outcomeStatus === "passed"
      ? [
          "Kane verified: " + kaneGuidance.behavior,
          kaneGuidance.evidence.length ? "Evidence: " + kaneGuidance.evidence.join("; ") : "",
          "Merge readiness: the branch can move toward merge because Kane verified the acceptance behavior.",
        ].filter(Boolean)
      : [];
  return {
    ...firstAttempt.build,
    id: "story_episode_" + stableHash([episode.feature.key, episode.key, firstAttempt.build.id, attempts.length]),
    type: "episode",
    status: outcomeStatus,
    label: episode.title,
    parentId,
    branchId,
    summary:
      "Idea explored: " + profile.explored +
      ". Learning: " + learning +
      ". Verification: " + survival,
    detail: [
      "Original assumption: " + profile.assumption,
      "Challenge: " + profile.challenge,
      "How thinking changed: " + profile.shift,
      "New idea: " + profile.emerged,
      "Reason to care: " + profile.matters,
      "Attempts: " + attempts.length,
      "Verification outcome: " + verification,
      "Did the idea survive verification? " + survival,
      ...kaneDetailLines,
      "Files changed: " + (files.length ? files.join(", ") : "No file list reported"),
    ],
    files,
    rawEventIds: attempts.flatMap((attempt) => attempt.build.rawEventIds || []),
    intent: episode.key,
    confidence: Math.max(...attempts.map((attempt) => attempt.build.confidence || 0), 0.75),
    metadata: {
      ...(firstAttempt.build.metadata || {}),
      ...ideaMetadata(profile),
      storyNode: true,
      storyKind: "episode",
      featureKey: episode.feature.key,
      featureTitle: episode.feature.title,
      episodeKey: episode.key,
      attemptCount: attempts.length,
      failedAttempts,
      experimentLearning: learning,
      experimentSurvival: survival,
      curiosityPrompt: branchCuriosityFromAttempts(attempts, profile),
      kaneBehavior: kaneGuidance.behavior,
      kaneFailure: kaneGuidance.failure,
      kaneWhyItMatters: kaneGuidance.why,
      kiroNextAction: kaneGuidance.next,
      kaneEvidence: kaneGuidance.evidence,
      storySteps,
      childEventIds: attempts.flatMap((attempt) => [attempt.build.id, attempt.verify?.id, attempt.outcome?.id].filter(Boolean) as string[]),
      lastAttemptId: lastAttempt?.build.id,
      rawEvents,
    },
  };
}

function visibleStoryParent(event: CommonDevelopmentEvent, fallbackParentId: string | null, output: CommonDevelopmentEvent[]) {
  return event.parentId && output.some((item) => item.id === event.parentId)
    ? event.parentId
    : fallbackParentId;
}

function commonEventsToControlTowerStoryEvents(semanticEvents: CommonDevelopmentEvent[]): CommonDevelopmentEvent[] {
  const output: CommonDevelopmentEvent[] = [];
  const first = semanticEvents[0];
  const hasSession = semanticEvents.some((event) => semanticEventType(event) === "session");
  const mainBranch = semanticEvents.find((event) => event.branchId === "main")?.branchId || "main";
  let fallbackParentId: string | null = null;

  if (first && !hasSession) {
    const session = makeSemanticEvent({
      type: "session",
      id: semanticId("control_tower_session", [first.id || first.timestamp]),
      timestamp: shiftedIso(first.timestamp, -500),
      source: "system",
      label: "Control Tower: Kiro/Kane/Codex loop",
      summary: "OpenBranch coordinates the goal, build handoff, Kane verification, next action, fix, re-verification, and accepted idea.",
      parentId: null,
      branchId: mainBranch,
      metadata: { controlTowerStep: true, storyNode: true, storyKind: "control_tower" },
    });
    output.push(session);
    fallbackParentId = session.id;
  }

  for (const event of semanticEvents) {
    const type = semanticEventType(event);
    const next = {
      ...event,
      parentId: type === "session" ? null : visibleStoryParent(event, fallbackParentId, output),
      metadata: { ...(event.metadata || {}), controlTowerStep: true, storyNode: true, storyKind: "control_tower" },
    };
    output.push(next);
    fallbackParentId = next.id;
  }

  return output;
}

export function commonEventsToStoryEvents(events: CommonDevelopmentEvent[]): CommonDevelopmentEvent[] {
  const semanticEvents = commonEventsToSemanticEvents(events);
  if (!semanticEvents.length) return [];
  if (semanticEvents.some((event) => event.metadata?.controlTowerStep)) {
    return commonEventsToControlTowerStoryEvents(semanticEvents);
  }

  const output: CommonDevelopmentEvent[] = [];
  const first = semanticEvents[0];
  const hasSession = semanticEvents.some((event) => semanticEventType(event) === "session");
  const mainBranch = semanticEvents.find((event) => event.branchId === "main")?.branchId || "main";
  let trunkParentId: string | null = null;

  if (!hasSession) {
    const session = makeSemanticEvent({
      type: "session",
      id: semanticId("session", [first.id || first.timestamp]),
      timestamp: shiftedIso(first.timestamp, -500),
      source: "system",
      label: storySessionTitle(semanticEvents),
      summary: "A development session groups the goal, planning work, feature branches, attempts, failures, and merges into one story.",
      parentId: null,
      branchId: mainBranch,
      metadata: { storyNode: true, storyKind: "session" },
    });
    output.push(session);
    trunkParentId = session.id;
  }

  const appendTrunk = (event: CommonDevelopmentEvent) => {
    const type = semanticEventType(event);
    const next = {
      ...event,
      branchId: mainBranch,
      parentId: type === "session" ? null : visibleStoryParent(event, trunkParentId, output),
      metadata: { ...(event.metadata || {}), storyNode: true, storyKind: type || "trunk" },
    };
    output.push(next);
    trunkParentId = next.id;
  };

  const attempts: StoryAttempt[] = [];
  const explicitMerges: CommonDevelopmentEvent[] = [];
  const featureByEventId = new Map<string, StoryFeatureInfo>();
  let lastFailedAttempt: StoryAttempt | null = null;
  let activeFixBranch: { event: CommonDevelopmentEvent; feature: StoryFeatureInfo } | null = null;
  let activeFeature: StoryFeatureInfo | null = null;

  const rememberAttempt = (attempt: StoryAttempt) => {
    attempts.push(attempt);
    for (const id of [attempt.build.id, attempt.verify?.id, attempt.outcome?.id].filter(Boolean) as string[]) {
      featureByEventId.set(id, attempt.feature);
    }
    activeFeature = attempt.feature;
    if (semanticEventType(attempt.outcome) === "fail") {
      lastFailedAttempt = attempt;
      activeFixBranch = null;
    }
  };

  for (let i = 0; i < semanticEvents.length; i += 1) {
    const event = semanticEvents[i];
    const type = semanticEventType(event);

    if (type === "session" || type === "goal" || type === "plan" || type === "spec" || type === "task") {
      appendTrunk(event);
      continue;
    }

    if (type === "build_attempt") {
      let verify: CommonDevelopmentEvent | null = null;
      let outcome: CommonDevelopmentEvent | null = null;
      let consumed = i;

      for (let j = i + 1; j < semanticEvents.length; j += 1) {
        const next = semanticEvents[j];
        const nextType = semanticEventType(next);
        if (next.branchId !== event.branchId && nextType !== "fail") break;
        if (nextType === "verify" && !verify) {
          verify = next;
          consumed = j;
          continue;
        }
        if (nextType === "pass") {
          outcome = next;
          consumed = j;
          continue;
        }
        if (nextType === "fail") {
          outcome = next;
          consumed = j;
          break;
        }
        break;
      }

      const feature = inferFeatureInfo(event, [verify, outcome], activeFeature);
      rememberAttempt({
        build: event,
        verify,
        outcome,
        feature,
        order: attempts.length,
      });
      i = consumed;
      continue;
    }

    if (type === "feature_branch" || type === "fix_branch") {
      const feature = inferFeatureInfo(event, [], lastFailedAttempt?.feature || activeFeature);
      activeFixBranch = { event, feature };
      activeFeature = feature;
      featureByEventId.set(event.id, feature);
      continue;
    }

    if ((type === "pass" || type === "fail") && activeFixBranch) {
      const fixBuild = makeSemanticEvent({
        type: "build_attempt",
        id: semanticId("fix_build", [activeFixBranch.event.id, event.id]),
        timestamp: shiftedIso(event.timestamp, -500),
        source: "agent",
        label: activeFixBranch.event.label.replace(/^Open fix branch for\s+/i, "Fix "),
        summary: "The AI applies the fix branch changes as another attempt on " + activeFixBranch.feature.branchId + ".",
        parentId: null,
        branchId: activeFixBranch.feature.branchId,
        files: event.files || activeFixBranch.event.files,
        rawEventIds: event.rawEventIds || activeFixBranch.event.rawEventIds,
        intent: event.intent || activeFixBranch.event.intent,
        metadata: activeFixBranch.event.metadata,
      });
      const verify = makeSemanticEvent({
        type: "verify",
        id: semanticId("fix_verify", [activeFixBranch.event.id, event.id]),
        timestamp: shiftedIso(event.timestamp, -250),
        source: "kane",
        label: "Verify fix attempt",
        summary: "Kane verifies the retry before the feature branch can merge back.",
        parentId: fixBuild.id,
        branchId: activeFixBranch.feature.branchId,
        files: event.files || activeFixBranch.event.files,
        rawEventIds: event.rawEventIds || activeFixBranch.event.rawEventIds,
        intent: event.intent || activeFixBranch.event.intent,
      });
      rememberAttempt({
        build: fixBuild,
        verify,
        outcome: event,
        feature: activeFixBranch.feature,
        fallbackBuildStep: syntheticStoryStep(fixBuild, "Build", "agent", fixBuild.summary || "The AI builds the retry."),
        order: attempts.length,
      });
      if (type === "pass") activeFixBranch = null;
      continue;
    }

    if (type === "merge") {
      explicitMerges.push(event);
      continue;
    }
  }

  const featureGroups = new Map<string, {
    feature: StoryFeatureInfo;
    attempts: StoryAttempt[];
    merges: CommonDevelopmentEvent[];
  }>();

  const ensureFeatureGroup = (feature: StoryFeatureInfo) => {
    let group = featureGroups.get(feature.key);
    if (!group) {
      group = { feature, attempts: [], merges: [] };
      featureGroups.set(feature.key, group);
    }
    return group;
  };

  attempts
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((attempt) => {
      ensureFeatureGroup(attempt.feature).attempts.push(attempt);
    });

  explicitMerges.forEach((merge) => {
    const feature = (merge.mergeParentIds || [])
      .map((id) => featureByEventId.get(id))
      .find(Boolean) || inferFeatureInfo(merge, [], activeFeature);
    ensureFeatureGroup(feature).merges.push(merge);
  });

  let mainHeadId = trunkParentId;
  for (const group of featureGroups.values()) {
    const firstAttempt = group.attempts[0];
    const feature = group.feature;
    const profile = ideaProfileForKey(feature.key, feature.title);
    const branchFailures = group.attempts.filter((attempt) => outcomeForEpisode(attempt.outcome) === "failed").length;
    const branchOutcome = outcomeForAttempts(group.attempts);
    const branchLearning = branchLearningFromAttempts(group.attempts, profile);
    const branchSurvival = survivalForOutcome(branchOutcome, branchFailures);
    const featureBranch = makeSemanticEvent({
      type: "feature_branch",
      id: semanticId("feature_branch", [feature.key]),
      timestamp: shiftedIso(firstAttempt?.build.timestamp || first.timestamp, -250),
      source: "agent",
      label: "Experiment: " + feature.title,
      summary: "Idea explored: " + profile.explored + ". Learning: " + branchLearning + ". Verification: " + branchSurvival,
      parentId: mainHeadId,
      branchId: feature.branchId,
      intent: feature.key,
      metadata: {
        ...ideaMetadata(profile),
        storyNode: true,
        storyKind: "feature_branch",
        featureKey: feature.key,
        featureTitle: feature.title,
        experimentLearning: branchLearning,
        experimentSurvival: branchSurvival,
        curiosityPrompt: branchCuriosityFromAttempts(group.attempts, profile),
      },
    });
    output.push(featureBranch);

    let featureHeadId: string | null = featureBranch.id;
    const episodes = groupAttemptsIntoEpisodes(group.attempts);
    episodes.forEach((episode) => {
      const episodeEvent = makeStoryEpisodeEvent({
        episode,
        parentId: featureHeadId,
        branchId: feature.branchId,
      });
      output.push(episodeEvent);
      featureHeadId = episodeEvent.id;
    });

    const lastEpisode = episodes[episodes.length - 1];
    const lastAttempt = lastEpisode?.attempts[lastEpisode.attempts.length - 1];
    const completed = semanticEventType(lastAttempt?.outcome) === "pass";
    if (!lastAttempt || !completed || !featureHeadId) continue;

    const explicitMerge = group.merges[0];
    const mergeFiles = lastEpisode ? uniqueAttemptFiles(lastEpisode.attempts) : lastAttempt.build.files;
    const merge = makeSemanticEvent({
      type: "merge",
      id: semanticId("feature_merge", [feature.key, featureHeadId, mainHeadId]),
      timestamp: shiftedIso(lastAttempt.outcome?.timestamp || lastAttempt.build.timestamp, 500),
      source: "merge",
      label: "Merge lesson: " + feature.title,
      summary: explicitMerge?.summary || "Idea carried forward: " + profile.emerged + ". It matters because " + profile.matters + ".",
      parentId: mainHeadId,
      branchId: mainBranch,
      mergeParentIds: [featureHeadId],
      files: mergeFiles,
      rawEventIds: lastAttempt.build.rawEventIds,
      intent: feature.key,
      detail: explicitMerge?.detail || [
        "Idea carried forward: " + profile.emerged,
        "Evidence: " + branchSurvival,
        "Learning kept: " + branchLearning,
      ],
      metadata: {
        ...(explicitMerge?.metadata || {}),
        ...ideaMetadata(profile),
        storyNode: true,
        storyKind: "merge",
        featureKey: feature.key,
        featureTitle: feature.title,
        experimentLearning: branchLearning,
        experimentSurvival: branchSurvival,
        curiosityPrompt: "The next main-line node can now build on this carried-forward idea instead of reopening the same question.",
      },
    });
    output.push(merge);
    mainHeadId = merge.id;
  }

  return output;
}

export function commonEventColor(event?: CommonDevelopmentEvent | null): string | null {
  if (!event) return null;
  if (event.status === "failed" || event.status === "deleted" || event.type.includes("failure")) return "#dc2626";
  if (event.status === "passed") return "#16a34a";
  if (event.status === "merged") return "#d97706";
  const type = semanticEventType(event);
  if (type) return SEMANTIC_COLORS[type];
  if (event.source === "user") return "#71717a";
  if (event.source === "codex") return "#2563eb";
  if (event.source === "kiro") return "#2563eb";
  if (event.source === "kane") return "#16a34a";
  if (event.source === "merge") return "#d97706";
  return "#7c3aed";
}

export function commonEventLabel(event: CommonDevelopmentEvent): string {
  const type = semanticEventType(event);
  if (type) return SOURCE_LABEL[event.source] + " / " + SEMANTIC_TYPE_LABEL[type];
  return SOURCE_LABEL[event.source] + " / " + event.status;
}

function activityKind(event: CommonDevelopmentEvent): CommitActivity["kind"] {
  const type = semanticEventType(event);
  if (type === "fail" || event.status === "failed" || event.status === "deleted") return "error";
  if (type === "plan" || type === "spec" || type === "task") return "planning";
  if (type === "build_attempt" || type === "feature_branch" || type === "fix_branch" || isFileEvent(event)) return "tool";
  return "done";
}

function humanList(items: string[], limit = 4) {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (!clean.length) return "";
  const shown = clean.slice(0, limit);
  if (clean.length > limit) shown.push(clean.length - limit + " more");
  if (shown.length === 1) return shown[0];
  if (shown.length === 2) return shown[0] + " and " + shown[1];
  return shown.slice(0, -1).join(", ") + ", and " + shown[shown.length - 1];
}

function storyKind(event: CommonDevelopmentEvent) {
  return typeof event.metadata?.storyKind === "string" ? event.metadata.storyKind : "";
}

function featureTitle(event: CommonDevelopmentEvent) {
  return asString(event.metadata?.featureTitle, titleFromFeatureKey(asString(event.intent, event.branchId.replace(/^feature\//, ""))));
}

function featureKey(event: CommonDevelopmentEvent) {
  return asString(event.metadata?.featureKey, asString(event.intent, slugify(event.branchId.replace(/^feature\//, ""))));
}

function ideaProfileForKey(key: string, title: string): StoryIdeaProfile {
  if (key === "semantic-development-events") {
    return {
      assumption: "raw agent activity would become useful once OpenBranch gave every important moment a stable graph event",
      challenge: "file edits and tool output showed motion but still hid why the product understanding was changing",
      shift: "the thinking moved from recording actions to grouping evidence by intent, branch, and verification",
      emerged: "a semantic event adapter that turns goals, plans, attempts, checks, failures, retries, passes, and ideas chosen for main into story nodes",
      matters: "the graph can show how an AI build learned its way toward a product decision",
      explored: "whether Kiro and Kane signals can become an idea history instead of a task log",
      learned: "the smallest useful story unit is not a file change; it is a verified idea moving through a branch",
      curiosity: "The next node asks whether the graph can make that learning visible without flattening it into a report.",
    };
  }

  if (key === "live-event-probe") {
    return {
      assumption: "a live file-event feed would prove OpenBranch could watch development as it happened",
      challenge: "a live feed becomes noise unless each signal explains what the project learned",
      shift: "the thinking moved from proving the feed exists to asking how live signals become evidence for an evolving idea",
      emerged: "a live probe that tests whether the story can update while the project is still changing",
      matters: "OpenBranch can become a living development history instead of a recap written after the fact",
      explored: "whether live development activity can be translated into story nodes as the work unfolds",
      learned: "live events need interpretation before they become useful history",
      curiosity: "The next node shows whether live evidence can still feel coherent once it reaches the graph.",
    };
  }

  if (key === "story-graph-ui") {
    return {
      assumption: "a graph of nodes, colors, and branches would be enough to explain AI development",
      challenge: "structure alone still makes users infer the reason behind each branch",
      shift: "the thinking moved from showing topology to inviting the user through a sequence of idea changes",
      emerged: "a Story View where each click answers what idea changed, what survived, and why the next node matters",
      matters: "the graph becomes a product-thinking surface, not just a visualization of operations",
      explored: "whether the existing OpenBranch graph can make branches feel like experiments",
      learned: "users need the graph to explain the thought behind the shape, not only the shape itself",
      curiosity: "The next node tests whether that shape can pull the reader forward.",
    };
  }

  return {
    assumption: title + " could move forward as a normal implementation branch",
    challenge: "the branch still had to prove what changed in the product understanding, not just what changed in code",
    shift: "the thinking moved from tracking work done to asking what idea the branch tested",
    emerged: "a clearer product idea for " + title,
    matters: "future readers can understand why this work deserved to become part of the main story",
    explored: "whether " + title + " should become part of the product direction",
    learned: "the branch only matters if verification can turn its changes into confidence",
    curiosity: "The next node reveals what verification taught the project about this idea.",
  };
}

function ideaProfileForEvent(event: CommonDevelopmentEvent) {
  return ideaProfileForKey(featureKey(event), featureTitle(event));
}

function ideaMetadata(profile: StoryIdeaProfile) {
  return {
    ideaAssumption: profile.assumption,
    ideaChallenge: profile.challenge,
    ideaShift: profile.shift,
    ideaEmergence: profile.emerged,
    ideaMatters: profile.matters,
    experimentIdea: profile.explored,
    experimentLearning: profile.learned,
    curiosityPrompt: profile.curiosity,
  };
}

function ideaField(event: CommonDevelopmentEvent, key: string, fallback: string) {
  return asString(event.metadata?.[key], fallback);
}

function survivalForOutcome(status: string, failures: number) {
  if (status === "passed" && failures > 0) {
    return "Yes, but only after verification exposed the weak assumption and forced the branch to revise it.";
  }
  if (status === "passed") {
    return "Yes. Kane's check gave the idea enough confidence to keep moving.";
  }
  if (status === "failed") {
    return "Not yet. Kane turned the limitation into the next thing the branch has to understand.";
  }
  return "Not yet. Verification is still the open question.";
}

function branchLearningFromAttempts(attempts: StoryAttempt[], profile: StoryIdeaProfile) {
  const failures = attempts.filter((attempt) => outcomeForEpisode(attempt.outcome) === "failed").length;
  const passed = outcomeForAttempts(attempts) === "passed";
  if (failures > 0 && passed) {
    return profile.learned + "; the failed pass also showed that the graph must preserve the retry path, not erase it.";
  }
  if (failures > 0) {
    return profile.learned + "; the current lesson is that the first version has not explained enough to survive verification.";
  }
  if (passed) {
    return profile.learned + "; verification confirmed the idea without needing a visible correction.";
  }
  return profile.learned + "; the branch is still gathering evidence.";
}

function branchCuriosityFromAttempts(attempts: StoryAttempt[], profile: StoryIdeaProfile) {
  const failures = attempts.filter((attempt) => outcomeForEpisode(attempt.outcome) === "failed").length;
  const outcome = outcomeForAttempts(attempts);
  if (outcome === "passed" && failures > 0) {
    return "The next node shows the moment the failed assumption became a better idea.";
  }
  if (outcome === "passed") return "The next node shows how Kane turned the hypothesis into confidence.";
  if (outcome === "failed") return "The next node shows what broke the original assumption.";
  return profile.curiosity;
}

function storyPurposeFor(event: CommonDevelopmentEvent) {
  const key = featureKey(event);
  if (key === "semantic-development-events") {
    return "turn raw development activity into story-shaped events the app can explain";
  }
  if (key === "live-event-probe") {
    return "prove that live development events can flow into the graph instead of staying invisible in files";
  }
  if (key === "story-graph-ui") {
    return "make the graph read like a development story rather than a vertical trail of operations";
  }
  if (key.includes("adapter")) return "connect low-level build activity to a human-readable development story";
  if (key.includes("graph")) return "make the graph explain structure and direction more clearly";
  return "move this feature from an isolated idea toward something that could safely become part of main";
}

function outcomeNarrative(status: string) {
  if (status === "passed") return "The episode passed";
  if (status === "failed") return "The episode ended with a failure";
  return "The episode is still in progress";
}

function storyFilesPhrase(files: string[]) {
  if (!files.length) return "The adapter did not receive a file list, so the story focuses on the development event itself.";
  return "The work moved through " + humanList(files.map((file) => file.replace(/\\/g, "/"))) + ".";
}

function storyMarkdown(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join("\n\n");
}

function storyBullet(label: string, value: string) {
  return "- **" + label + ":** " + value;
}

function storyQuote(label: string, value: string) {
  return "> **" + label + ":** " + value;
}

function storyCodeBlock(lines: string[]) {
  return ["```text", ...lines, "```"].join("\n");
}

function compactStoryLine(value: string, limit = 86) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return clean.slice(0, limit - 1).replace(/\s+\S*$/, "") + "...";
}

function sentenceLead(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

function episodeNarrative(event: CommonDevelopmentEvent) {
  const attempts = Number(event.metadata?.attemptCount || 1);
  const failures = Number(event.metadata?.failedAttempts || 0);
  const profile = ideaProfileForEvent(event);
  const assumption = ideaField(event, "ideaAssumption", profile.assumption);
  const challenge = ideaField(event, "ideaChallenge", profile.challenge);
  const shift = ideaField(event, "ideaShift", profile.shift);
  const emerged = ideaField(event, "ideaEmergence", profile.emerged);
  const matters = ideaField(event, "ideaMatters", profile.matters);
  const explored = ideaField(event, "experimentIdea", profile.explored);
  const learned = ideaField(event, "experimentLearning", profile.learned);
  const survived = ideaField(event, "experimentSurvival", survivalForOutcome(event.status, failures));
  const curiosity = ideaField(event, "curiosityPrompt", profile.curiosity);
  const kaneGuidance = kaneGuidanceForEvent(event);

  if (failures > 0) {
    const failureBullets = [
      storyBullet("Kane tested", compactStoryLine(kaneGuidance.behavior, 112)),
      kaneGuidance.failure ? storyBullet("What failed", compactStoryLine(kaneGuidance.failure, 112)) : "",
      kaneGuidance.why ? storyBullet("Reason it matters", compactStoryLine(kaneGuidance.why, 112)) : "",
      kaneGuidance.next ? storyBullet("Kiro should fix next", compactStoryLine(kaneGuidance.next, 112)) : "",
    ].filter(Boolean).join("\n");
    return storyMarkdown([
      "### The useful failure",
      "Kane did something valuable here: it made the weak assumption visible before the branch could pretend it was finished.",
      "> \"This is not ready to become product truth yet.\"",
      "That turns the branch from implementation into inquiry.",
      storyCodeBlock([
        "assumption -> failed check -> sharper idea",
        compactStoryLine(assumption, 72) + " -> " + compactStoryLine(challenge, 72),
      ]),
      [
        storyBullet("New idea", compactStoryLine(emerged, 112)),
        storyBullet("What changed", compactStoryLine(shift, 112)),
        storyBullet("Survived verification?", compactStoryLine(survived, 112)),
      ].join("\n"),
      failureBullets,
      sentenceLead(matters),
      "The next interesting question is whether the fix branch keeps the lesson or only patches the symptom.",
    ]);
  }

  if (event.status === "passed") {
    const passBullets = [
      storyBullet("Behavior verified", compactStoryLine(kaneGuidance.behavior, 112)),
      kaneGuidance.evidence.length ? storyBullet("Evidence", compactStoryLine(kaneGuidance.evidence[0], 112)) : "",
      storyBullet("Merge direction", "the branch can move toward merge because Kane verified the acceptance behavior"),
    ].filter(Boolean).join("\n");
    return storyMarkdown([
      "### Kane's answer",
      "The branch asked a very specific question: can " + explored + "?",
      "Kane's answer is yes, and that matters because the idea now has evidence instead of confidence by assertion.",
      [
        storyBullet("What survived", compactStoryLine(survived, 112)),
        storyBullet("Development passes", String(attempts)),
        storyBullet("Lesson kept", compactStoryLine(learned, 112)),
      ].join("\n"),
      passBullets,
      "> " + compactStoryLine(emerged, 120),
      "The next click should show whether main treats that evidence as worth carrying forward.",
    ]);
  }

  return storyMarkdown([
    "This episode is still a live question. The branch has a direction, but Kane has not turned it into trust yet.",
    "### Open question",
    "Can " + explored + "?",
    [
      storyBullet("Starting belief", compactStoryLine(assumption, 112)),
      storyBullet("Pressure point", compactStoryLine(challenge, 112)),
      storyBullet("Early lesson", compactStoryLine(learned, 112)),
    ].join("\n"),
    "What makes it interesting: " + sentenceLead(curiosity).replace(/\.$/, "") + ".",
  ]);
}

function featureBranchNarrative(event: CommonDevelopmentEvent) {
  const key = featureKey(event);
  const title = featureTitle(event);
  const profile = ideaProfileForEvent(event);
  const assumption = ideaField(event, "ideaAssumption", profile.assumption);
  const challenge = ideaField(event, "ideaChallenge", profile.challenge);
  const explored = ideaField(event, "experimentIdea", profile.explored);
  const learned = ideaField(event, "experimentLearning", profile.learned);
  const survived = ideaField(event, "experimentSurvival", "Not yet. Verification is still the open question.");
  const curiosity = ideaField(event, "curiosityPrompt", profile.curiosity);

  if (key === "semantic-development-events") {
    return storyMarkdown([
      "### Question",
      "Can Kiro and Kane signals become an idea history instead of a task log?",
      "**Experiment:** isolate the branch and see whether raw agent activity can be grouped by intent, branch, and verification.",
      "**Lesson so far:** " + compactStoryLine(learned, 118),
      "**Verification:** " + compactStoryLine(survived, 118),
      "This is interesting because the branch is not just a place for work. It is a place for OpenBranch to change its mind.",
      "> " + curiosity,
    ]);
  }

  if (key === "story-graph-ui") {
    return storyMarkdown([
      "### Before / after",
      "| Before | After |",
      "| --- | --- |",
      "| A graph shows structure. | A graph explains why the structure matters. |",
      "| Nodes name events. | Nodes reveal the question each event is testing. |",
      "| A branch is a visual fork. | A branch is an experiment with evidence. |",
      "The branch is testing " + title + " by asking whether " + compactStoryLine(explored, 98) + ".",
      "The useful tension: " + compactStoryLine(challenge, 112),
    ]);
  }

  return storyMarkdown([
    "This branch opens a contained experiment: can " + title + " become part of the product direction without flattening the story?",
    [
      storyBullet("Question", "Can " + compactStoryLine(explored, 106) + "?"),
      storyBullet("Starting belief", compactStoryLine(assumption, 106)),
      storyBullet("Friction", compactStoryLine(challenge, 106)),
      storyBullet("Current lesson", compactStoryLine(learned, 110)),
      storyBullet("Verification", compactStoryLine(survived, 110)),
    ].join("\n"),
    "The reason to care: this is where the product gets permission to be wrong before main has to remember anything.",
    "A good next question: " + curiosity,
  ]);
}

function mergeNarrative(event: CommonDevelopmentEvent) {
  const title = featureTitle(event);
  const profile = ideaProfileForEvent(event);
  const shift = ideaField(event, "ideaShift", profile.shift);
  const emerged = ideaField(event, "ideaEmergence", profile.emerged);
  const learned = ideaField(event, "experimentLearning", profile.learned);
  const survived = ideaField(event, "experimentSurvival", "Yes. Verification gave the idea enough confidence to keep moving.");
  const matters = ideaField(event, "ideaMatters", profile.matters);
  const curiosity = ideaField(event, "curiosityPrompt", "The next main-line node can build from this carried-forward idea.");

  if (featureKey(event) === "story-graph-ui") {
    return storyMarkdown([
      "### The graph inherits a lesson",
      "The " + title + " branch returns with more than a UI improvement. It returns with a claim about how OpenBranch should explain development history.",
      storyQuote("Kept", emerged),
      "Main absorbs the part that survived Kane, not every detail of the experiment.",
      [
        storyBullet("Changed belief", compactStoryLine(shift, 112)),
        storyBullet("Evidence", compactStoryLine(survived, 112)),
        storyBullet("Lesson", compactStoryLine(learned, 112)),
      ].join("\n"),
      sentenceLead(matters),
    ]);
  }

  return storyMarkdown([
    "### Why main says yes",
    "OpenBranch accepts the " + title + " branch because it changed what the product now believes, not merely because a check turned green.",
    storyQuote("Carried forward", emerged),
    [
      storyBullet("Before the branch", compactStoryLine(shift, 112)),
      storyBullet("Kept from the experiment", compactStoryLine(learned, 112)),
      storyBullet("Evidence", compactStoryLine(survived, 112)),
    ].join("\n"),
    sentenceLead(matters),
    "That leaves main with a better next question: " + curiosity,
  ]);
}

function trunkNarrative(event: CommonDevelopmentEvent) {
  const type = semanticEventType(event);
  if (type === "session") {
    return storyMarkdown([
      "OpenBranch is treating this session less like a log and more like a trail of changing beliefs.",
      "> **Thesis:** AI development history should show how ideas evolve, not only what agents did.",
      "The interesting question is simple: when an agent branches, fails, retries, and merges, what did the project learn?",
      "That frame turns every later node into a small test of understanding.",
    ]);
  }
  if (type === "goal") {
    return storyMarkdown([
      "### The bet",
      "The user is betting that GitHub-style history can expand from code changes into AI development history.",
      [
        storyBullet("Ambition", "preserve evolving understanding"),
        storyBullet("Tension", "AI work changes through plans, failed checks, retries, and lessons, not just diffs"),
      ].join("\n"),
      "The next useful question is how Kiro turns that ambition into something testable.",
    ]);
  }
  if (type === "plan") {
    return storyMarkdown([
      "### Hypothesis",
      "> The graph needs semantic development events, not raw logs.",
      "If that is true, the story needs a translation layer:",
      storyCodeBlock(["raw activity -> semantic events -> idea history"]),
      "Now the plan has a sharper job: prove each branch can explain what it is trying to learn.",
    ]);
  }
  if (type === "spec") {
    return storyMarkdown([
      "### The rule change",
      "Before: a label could name an event.",
      "After: an event needs enough context to explain a change in understanding.",
      "A useful signal now carries:",
      [
        "- source",
        "- status",
        "- parentage",
        "- branch identity",
        "- the question being tested",
      ].join("\n"),
      "That makes verification meaningful instead of decorative.",
    ]);
  }
  if (type === "task") {
    return storyMarkdown([
      "### The handoff",
      "**Old question:** Did we add the events?",
      "**Better question:** Did the idea survive Kane's verification?",
      "That shift turns implementation into a learning loop. The next branch gets to test whether this frame holds.",
    ]);
  }
  return event.summary || event.label;
}

function controlTowerNarrative(event: CommonDevelopmentEvent) {
  const type = semanticEventType(event);
  const guidance = kaneGuidanceForEvent(event);
  const kiroExecuted = event.metadata?.kiroExecuted === true;
  const kaneExecuted = event.metadata?.kaneExecuted === true;
  const kaneAttempted = event.metadata?.kaneExecutionAttempted === true;
  const existingKaneRun = event.metadata?.existingKaneRun === true;
  const executionFailure = event.metadata?.executionFailure === true;
  const codexPmStage = asString(event.metadata?.codexPmStage);
  const codexPmExecuted = event.metadata?.codexPmExecuted === true;
  const codexPmFallback = event.metadata?.codexPmFallback === true;
  if (type === "session") {
    return storyMarkdown([
      "OpenBranch is acting as the control tower for this loop.",
      storyCodeBlock([
        "goal -> build -> verify -> debug instruction -> fix -> re-verify -> accept",
      ]),
      "The important change is agency: OpenBranch is not only watching the story, it is producing the files and instructions the next agent can use.",
    ]);
  }
  if (type === "goal") {
    return storyMarkdown([
      "### Goal proposed",
      event.summary || "OpenBranch created the development goal.",
      "The handoff file is `.tmp/openbranch-goal.md`, so Kiro and Codex can start from the same source of truth.",
    ]);
  }
  if (event.source === "codex" && codexPmFallback) {
    return storyMarkdown([
      "### Codex PM fallback mode",
      event.summary || "OpenBranch prepared the PM handoff locally because no Codex/OpenAI API execution was available.",
      [
        storyBullet("Model requested", asString(event.metadata?.codexPmModel, "not configured")),
        storyBullet("Execution evidence", "fallback only; `.tmp/codex-run.log` records why the API did not run"),
        storyBullet("Next agent", "Kiro still receives `.tmp/kiro-build-task.md`, so the demo can continue"),
      ].join("\n"),
    ]);
  }
  if (event.source === "codex" && codexPmStage === "reframed_goal" && codexPmExecuted) {
    return storyMarkdown([
      "### Codex PM reframed goal",
      event.summary || "The real Codex PM API turned the user request into a tighter product goal.",
      storyQuote("Reframed goal", compactStoryLine(event.detail?.[0] || event.summary || "", 160)),
      "Execution evidence lives in `.tmp/codex-run.log`.",
    ]);
  }
  if (event.source === "codex" && codexPmStage === "plan_generated" && codexPmExecuted) {
    return storyMarkdown([
      "### Codex PM plan generated",
      event.summary || "The real Codex PM API generated the development plan, acceptance criteria, Kiro task, and Kane task.",
      [
        storyBullet("Execution evidence", "`.tmp/codex-run.log`"),
        storyBullet("Kiro task", "`.tmp/kiro-build-task.md`"),
        storyBullet("Kane task", "`.tmp/kane-verification-task.md`"),
      ].join("\n"),
    ]);
  }
  if (event.source === "codex" && codexPmStage === "accepted_lesson" && codexPmExecuted) {
    return storyMarkdown([
      "### Codex PM accepted lesson",
      event.summary || "The real Codex PM API reviewed Kane feedback and wrote the lesson OpenBranch should preserve.",
      [
        storyBullet("Evidence", "`.tmp/codex-run.log` and `.tmp/kane-result.json`"),
        storyBullet("Merge direction", "the PM acceptance is now attached to the final OpenBranch merge"),
      ].join("\n"),
    ]);
  }
  if (type === "build_attempt") {
    if (!kiroExecuted) {
      return storyMarkdown([
        "### Kiro task prepared",
        event.summary || "OpenBranch prepared a builder task for Kiro.",
        [
          storyBullet("Branch", event.branchId),
          storyBullet("Execution evidence", "not present yet; see Technical Details for the handoff and logs"),
          storyBullet("Behavior Kane will check", compactStoryLine(guidance.behavior, 112)),
        ].join("\n"),
      ]);
    }
    return storyMarkdown([
      "### Kiro Builder executed",
      event.summary || "OpenBranch invoked Kiro with the builder task.",
      [
        storyBullet("Branch", event.branchId),
        storyBullet("Execution evidence", "`.tmp/kiro-run.log`"),
        storyBullet("Behavior Kane will check", compactStoryLine(guidance.behavior, 112)),
      ].join("\n"),
      "This is an execution claim only. It does not claim implementation unless the run log or file diff proves it.",
    ]);
  }
  if (type === "verify") {
    if (existingKaneRun) {
      return storyMarkdown([
        "### Kane result ingested",
        event.summary || "OpenBranch ingested an existing Kane Power result.",
        storyQuote("Behavior", guidance.behavior),
        "This is evidence from Kane, but OpenBranch is not claiming it triggered that run.",
      ]);
    }
    if (!kaneExecuted) {
      return storyMarkdown([
        "### Kane verification prepared",
        event.summary || "OpenBranch prepared the verifier task.",
        storyQuote("Behavior", guidance.behavior),
        "The verifier is not marked executed until `.tmp/kane-run.log` shows a Kane CLI process was started.",
      ]);
    }
    return storyMarkdown([
      "### Kane Verifier executed",
      "OpenBranch started Kane CLI and captured the verifier run.",
      storyQuote("Behavior", guidance.behavior),
      "Execution evidence lives in `.tmp/kane-run.log`; parsed result evidence lives in `.tmp/kane-result.json`.",
      "The result will either become a debugging instruction or acceptance evidence.",
    ]);
  }
  if (type === "fail") {
    if (executionFailure || (kaneAttempted && event.metadata?.kaneVerified === false)) {
      return storyMarkdown([
        "### Verifier did not complete",
        "This node records a real execution gap instead of pretending a browser check passed or failed product behavior.",
        [
          storyBullet("Behavior requested", compactStoryLine(guidance.behavior, 112)),
          storyBullet("What blocked it", compactStoryLine(guidance.failure || event.summary || "Kane did not return a passing verifier result.", 112)),
          storyBullet("Evidence", "`.tmp/kane-run.log` and `.tmp/kane-result.json`"),
          storyBullet("Kiro should fix next", compactStoryLine(guidance.next || "Repair the verifier setup or app behavior, then rerun Kane.", 112)),
        ].join("\n"),
      ]);
    }
    if (existingKaneRun) {
      return storyMarkdown([
        "### Existing Kane result failed",
        "OpenBranch ingested a real Kane Power result that already existed locally.",
        [
          storyBullet("Kane tested", compactStoryLine(guidance.behavior, 112)),
          storyBullet("What failed", compactStoryLine(guidance.failure || event.summary || "Kane reported a failure.", 112)),
          storyBullet("Execution claim", "ingested evidence only; this OpenBranch run did not start Kane"),
        ].join("\n"),
      ]);
    }
    return storyMarkdown([
      "### Kane found the break",
      "This is the loop doing its job: a browser check turned uncertainty into a concrete repair target.",
      [
        storyBullet("Kane tested", compactStoryLine(guidance.behavior, 112)),
        storyBullet("What failed", compactStoryLine(guidance.failure || event.summary || "Kane reported a failure.", 112)),
        storyBullet("Reason it matters", compactStoryLine(guidance.why || "The branch cannot be accepted until this behavior holds.", 112)),
        storyBullet("Kiro should fix next", compactStoryLine(guidance.next || "Patch the branch and rerun Kane.", 112)),
      ].join("\n"),
    ]);
  }
  if (type === "task") {
    return storyMarkdown([
      "### Debug instruction generated",
      event.summary || "OpenBranch wrote the next action for Kiro/Codex.",
      "The useful artifact is `.tmp/kiro-next-action.md`: it turns Kane's result into the next fix instruction.",
    ]);
  }
  if (type === "fix_branch") {
    return storyMarkdown([
      "### Fix attempted",
      event.summary || "Kiro/Codex applies the repair on a fix branch.",
      "This keeps the failed idea visible while the retry gets its own verification path.",
    ]);
  }
  if (type === "pass") {
    if (existingKaneRun) {
      return storyMarkdown([
        "### Existing Kane result passed",
        "OpenBranch ingested real Kane evidence that was already on disk.",
        [
          storyBullet("Behavior verified", compactStoryLine(guidance.behavior, 112)),
          storyBullet("Evidence", compactStoryLine(guidance.evidence[0] || event.summary || "Kane returned a passing result.", 112)),
          storyBullet("Execution claim", "ingested evidence only; this OpenBranch run did not start Kane"),
        ].join("\n"),
      ]);
    }
    return storyMarkdown([
      kaneExecuted ? "### Kane Verifier passed" : "### Passing result ingested",
      kaneExecuted
        ? "The Kane CLI run produced passing evidence for the requested behavior."
        : "OpenBranch has a passing result, but Technical Details should be checked before treating it as a fresh verifier run.",
      [
        storyBullet("Behavior verified", compactStoryLine(guidance.behavior, 112)),
        storyBullet("Evidence", compactStoryLine(guidance.evidence[0] || event.summary || "Kane returned a passing result.", 112)),
        storyBullet("Merge direction", "the branch can move toward acceptance because the checked behavior survived"),
      ].join("\n"),
    ]);
  }
  if (type === "merge") {
    return storyMarkdown([
      event.label === "Accepted Lesson" ? "### Accepted Lesson" : "### Idea accepted",
      event.summary || "The verified idea is accepted back into main.",
      "OpenBranch records the accepted idea with the verification trail still attached.",
    ]);
  }
  return event.summary || event.label;
}

function storyNarrativeForEvent(event: CommonDevelopmentEvent) {
  const kind = storyKind(event);
  if (event.metadata?.controlTowerStep) return controlTowerNarrative(event);
  if (kind === "episode") return episodeNarrative(event);
  if (kind === "feature_branch") return featureBranchNarrative(event);
  if (kind === "merge") return mergeNarrative(event);
  return trunkNarrative(event);
}

function technicalDetailsForEvent(event: CommonDevelopmentEvent) {
  const lines = [`**${event.label}**`];
  if (event.summary) lines.push(event.summary);
  if (event.detail?.length) lines.push(event.detail.map((item) => "- " + item).join("\n"));
  const executionCommand = asString(event.metadata?.executionCommand);
  const executionArtifacts = toArrayOfStrings(event.metadata?.executionArtifacts);
  if (executionCommand || executionArtifacts?.length) {
    lines.push(
      [
        "Execution evidence:",
        executionCommand ? "- Command: " + executionCommand : "",
        typeof event.metadata?.executionExitStatus === "number" ? "- Exit status: " + event.metadata.executionExitStatus : "",
        ...(executionArtifacts || []).map((artifact) => "- Artifact: " + artifact),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const storySteps = Array.isArray(event.metadata?.storySteps) ? event.metadata.storySteps : [];
  if (storySteps.length) {
    const heading = event.metadata?.storyKind === "episode" ? "Attempts" : "Episode steps";
    lines.push(
      heading + ":\n" +
        storySteps
          .map((step) => {
            if (!isRecord(step)) return "";
            return "- " + asString(step.label, "Step");
          })
          .filter(Boolean)
          .join("\n"),
    );
  }
  if (event.files?.length) lines.push("Files:\n" + event.files.map((file) => "- " + file).join("\n"));
  const rawEvents = Array.isArray(event.metadata?.rawEvents) ? event.metadata.rawEvents : [];
  if (rawEvents.length) {
    lines.push(
      "Low-level events:\n" +
        rawEvents
          .map((raw) => {
            if (!isRecord(raw)) return "";
            return "- " + asString(raw.label, asString(raw.type, "event"));
          })
          .filter(Boolean)
          .join("\n"),
    );
  }
  lines.push([
    `Source: ${SOURCE_LABEL[event.source]}`,
    `Type: ${semanticEventType(event) ? SEMANTIC_TYPE_LABEL[semanticEventType(event)!] : event.type}`,
    `Status: ${event.status}`,
    `Branch: ${event.branchId}`,
  ].join("\n"));
  return lines.join("\n\n");
}

function technicalDetailsBodyForEvent(event: CommonDevelopmentEvent) {
  return technicalDetailsForEvent(event)
    .split("\n\n")
    .filter((section) => section !== `**${event.label}**`)
    .join("\n\n");
}

function responseForEvent(event: CommonDevelopmentEvent): string {
  if (!event.metadata?.storyNode) return technicalDetailsForEvent(event);
  return [`**${event.label}**`, storyNarrativeForEvent(event)].join("\n\n");
}

function activityForEvent(event: CommonDevelopmentEvent, ts: number): CommitActivity {
  const errored = activityKind(event) === "error";
  return {
    id: event.id + "-activity",
    kind: activityKind(event),
    label: commonEventLabel(event),
    detail: event.summary || event.label,
    status: errored ? "error" : "done",
    source: event.source,
    startedAt: ts,
    endedAt: ts + 250,
    durationMs: 250,
  };
}

function activitiesForEvent(event: CommonDevelopmentEvent, ts: number): CommitActivity[] {
  const storySteps = Array.isArray(event.metadata?.storySteps) ? event.metadata.storySteps : [];
  if (!storySteps.length) return [activityForEvent(event, ts)];
  return storySteps
    .filter(isRecord)
    .map((step, index) => {
      const stepTs = ts + index * 250;
      const status = asString(step.status, "done") as CommitActivity["status"];
      return {
        id: asString(step.id, event.id + "-story-step-" + index),
        kind: asString(step.kind, "tool") as CommitActivity["kind"],
        label: asString(step.label, "Step"),
        detail: asString(step.detail, undefined as unknown as string),
        status,
        source: asString(step.source, event.source),
        startedAt: stepTs,
        endedAt: status === "running" || status === "pending" ? undefined : stepTs + 250,
        durationMs: status === "running" || status === "pending" ? undefined : 250,
      };
    });
}

function visibleEventsForView(events: CommonDevelopmentEvent[], view: DevelopmentGraphView) {
  return view === "raw" ? commonEventsToSemanticEvents(events) : commonEventsToStoryEvents(events);
}

export function commonEventsToCommits(
  events: CommonDevelopmentEvent[],
  options: { view?: DevelopmentGraphView } = {},
): Commit[] {
  const visibleEvents = visibleEventsForView(events, options.view || "story");
  return visibleEvents.map((event, index) => {
    const ts = Date.parse(event.timestamp);
    const safeTs = Number.isFinite(ts) ? ts : Date.now() + index;
    return {
      id: event.id,
      parentId: event.parentId,
      mergeIds: event.mergeParentIds || [],
      branch: event.branchId || "main",
      ts: safeTs,
      prompt: event.label,
      response: responseForEvent(event),
      model: SOURCE_LABEL[event.source],
      mode: "code",
      activities: activitiesForEvent(event, safeTs),
      liveEvent: event,
      storyTechnicalDetails: event.metadata?.storyNode ? technicalDetailsBodyForEvent(event) : undefined,
      displayLabel: event.label,
    };
  });
}
