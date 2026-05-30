import type {
  CommonDevelopmentEvent,
  Commit,
  CommitActivity,
  SemanticDevelopmentEventType,
} from "@/types";

export const LIVE_EVENTS_URL = "/events.jsonl";

const SOURCE_LABEL: Record<CommonDevelopmentEvent["source"], string> = {
  user: "User",
  kiro: "Kiro",
  kane: "Kane",
  agent: "Agent",
  merge: "Merge",
  system: "System",
};

const SEMANTIC_TYPE_LABEL: Record<SemanticDevelopmentEventType, string> = {
  goal: "Goal",
  plan: "Plan",
  spec: "Spec",
  task: "Task",
  build_attempt: "Build Attempt",
  verify: "Verify",
  fail: "Fail",
  pass: "Pass",
  fix_branch: "Fix Branch",
  merge: "Merge",
};

const SEMANTIC_STATUS: Record<SemanticDevelopmentEventType, string> = {
  goal: "goal",
  plan: "planned",
  spec: "specified",
  task: "tasked",
  build_attempt: "building",
  verify: "verifying",
  fail: "failed",
  pass: "passed",
  fix_branch: "branching",
  merge: "merged",
};

const SEMANTIC_COLORS: Record<SemanticDevelopmentEventType, string> = {
  goal: "#71717a",
  plan: "#2563eb",
  spec: "#2563eb",
  task: "#2563eb",
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
    build: "build_attempt",
    build_attempt: "build_attempt",
    kiro_build: "build_attempt",
    kiro_build_attempt: "build_attempt",
    verify: "verify",
    verification: "verify",
    kane_verify: "verify",
    fail: "fail",
    failed: "fail",
    failure: "fail",
    kane_fail: "fail",
    kane_failure: "fail",
    pass: "pass",
    passed: "pass",
    success: "pass",
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
  if (type === "goal") return "user";
  if (type === "plan" || type === "spec" || type === "task" || type === "build_attempt") return "kiro";
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

export function commonEventColor(event?: CommonDevelopmentEvent | null): string | null {
  if (!event) return null;
  const type = semanticEventType(event);
  if (type) return SEMANTIC_COLORS[type];
  if (event.status === "failed" || event.status === "deleted" || event.type.includes("failure")) return "#dc2626";
  if (event.source === "user") return "#71717a";
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
  if (type === "build_attempt" || type === "fix_branch" || isFileEvent(event)) return "tool";
  return "done";
}

function responseForEvent(event: CommonDevelopmentEvent): string {
  const lines = [`**${event.label}**`];
  if (event.summary) lines.push(event.summary);
  if (event.detail?.length) lines.push(event.detail.map((item) => "- " + item).join("\n"));
  if (event.files?.length) lines.push("Files:\n" + event.files.map((file) => "- " + file).join("\n"));
  lines.push([
    `Source: ${SOURCE_LABEL[event.source]}`,
    `Type: ${semanticEventType(event) ? SEMANTIC_TYPE_LABEL[semanticEventType(event)!] : event.type}`,
    `Status: ${event.status}`,
    `Branch: ${event.branchId}`,
  ].join("\n"));
  return lines.join("\n\n");
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

export function commonEventsToCommits(events: CommonDevelopmentEvent[]): Commit[] {
  const semanticEvents = commonEventsToSemanticEvents(events);
  return semanticEvents.map((event, index) => {
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
      activities: [activityForEvent(event, safeTs)],
      liveEvent: event,
      displayLabel: event.label,
    };
  });
}
