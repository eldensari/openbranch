import type {
  CommonDevelopmentEvent,
  Commit,
  CommitActivity,
  CommitId,
  DevelopmentEvent,
  DevelopmentEventKind,
  DevelopmentEventSource,
  DevelopmentEventStatus,
} from "@/types";
import { commonEventsToCommits, type DevelopmentGraphView } from "@/lib/common-events";

export const DEVELOPMENT_EVENT_COLORS: Record<DevelopmentEventKind, string> = {
  user_goal: "#71717a",
  kiro_plan: "#2563eb",
  kiro_spec: "#2563eb",
  kiro_task: "#2563eb",
  kiro_build_attempt: "#2563eb",
  kane_verify: "#16a34a",
  kane_failure: "#dc2626",
  ai_fix_branch: "#7c3aed",
  kane_pass: "#16a34a",
  merge_to_main: "#d97706",
};

const SOURCE_LABEL: Record<DevelopmentEventSource, string> = {
  user: "User",
  kiro: "Kiro",
  kane: "Kane",
  ai: "AI",
  merge: "Merge",
};

const STATUS_LABEL: Record<DevelopmentEventStatus, string> = {
  goal: "Goal",
  planned: "Plan",
  specified: "Spec",
  tasked: "Task",
  building: "Build",
  verifying: "Verify",
  failed: "Fail",
  branching: "Fix branch",
  passed: "Pass",
  merged: "Merged",
};

export const SAMPLE_DEVELOPMENT_EVENTS: DevelopmentEvent[] = [
  {
    id: "dev-goal",
    kind: "user_goal",
    source: "user",
    status: "goal",
    title: "User Goal",
    summary: "Build an MVP called OpenBranch for AI Development.",
    branch: "main",
    parentId: null,
    sequence: 1,
    detail: [
      "Product vision: GitHub for AI Development.",
      "Track how agents plan, build, fail, branch, retry, pass tests, and merge.",
    ],
  },
  {
    id: "dev-kiro-plan",
    kind: "kiro_plan",
    source: "kiro",
    status: "planned",
    title: "Kiro Plan",
    summary: "Kiro creates a minimal plan for the event adapter and graph demo.",
    branch: "main",
    parentId: "dev-goal",
    sequence: 2,
    actor: "Kiro",
    detail: [
      "Define a development event format.",
      "Map events into OpenBranch commit graph nodes.",
      "Keep adapter boundaries ready for real Kiro hooks and Kane NDJSON.",
    ],
  },
  {
    id: "dev-kiro-spec",
    kind: "kiro_spec",
    source: "kiro",
    status: "specified",
    title: "Kiro Spec",
    summary: "Kiro defines the semantic development event schema.",
    branch: "main",
    parentId: "dev-kiro-plan",
    sequence: 3,
    actor: "Kiro",
    detail: [
      "Goal, plan, spec, task, build attempt, verify, fail, pass, fix branch, and merge.",
      "Events keep parent IDs, branch IDs, source, status, and optional files.",
    ],
  },
  {
    id: "dev-kiro-task",
    kind: "kiro_task",
    source: "kiro",
    status: "tasked",
    title: "Kiro Task",
    summary: "Kiro breaks the MVP into adapter, graph, and demo tasks.",
    branch: "main",
    parentId: "dev-kiro-spec",
    sequence: 4,
    actor: "Kiro",
    detail: [
      "Transform file watcher events into semantic build attempts.",
      "Render branches, failures, retries, passes, and merges in OpenBranch.",
    ],
  },
  {
    id: "dev-kiro-build",
    kind: "kiro_build_attempt",
    source: "kiro",
    status: "building",
    title: "Kiro Build Attempt",
    summary: "Kiro implements the first graph event stream.",
    branch: "main",
    parentId: "dev-kiro-task",
    sequence: 5,
    actor: "Kiro",
    detail: [
      "Adds sample events.",
      "Builds an adapter from development events to graph commits.",
      "Wires a demo button into the app shell.",
    ],
  },
  {
    id: "dev-kane-verify",
    kind: "kane_verify",
    source: "kane",
    status: "verifying",
    title: "Kane Verify",
    summary: "Kane runs checks against the new development graph.",
    branch: "main",
    parentId: "dev-kiro-build",
    sequence: 6,
    actor: "Kane",
    detail: [
      "Typecheck the adapter.",
      "Confirm graph nodes render with parent and branch metadata.",
    ],
  },
  {
    id: "dev-kane-failure",
    kind: "kane_failure",
    source: "kane",
    status: "failed",
    title: "Kane Failure",
    summary: "Kane finds a missing merge-back edge for the successful retry.",
    branch: "main",
    parentId: "dev-kane-verify",
    sequence: 7,
    actor: "Kane",
    detail: [
      "Failure is preserved on main instead of being overwritten.",
      "The fix must branch from the failed verification node.",
    ],
  },
  {
    id: "dev-ai-fix-branch",
    kind: "ai_fix_branch",
    source: "ai",
    status: "branching",
    title: "AI Fix Branch",
    summary: "An AI agent opens a fix branch from the failed Kane check.",
    branch: "fix/kane-merge-edge",
    parentId: "dev-kane-failure",
    sequence: 8,
    actor: "AI Agent",
    detail: [
      "Isolates the retry from main.",
      "Adds mergeParentIds so the graph can draw the successful return path.",
    ],
  },
  {
    id: "dev-kane-pass",
    kind: "kane_pass",
    source: "kane",
    status: "passed",
    title: "Kane Pass",
    summary: "Kane verifies the fix branch and marks the retry as passing.",
    branch: "fix/kane-merge-edge",
    parentId: "dev-ai-fix-branch",
    sequence: 9,
    actor: "Kane",
    detail: [
      "Adapter emits stable parent IDs.",
      "Graph shows the failed attempt and the passing retry side by side.",
    ],
  },
  {
    id: "dev-merge-main",
    kind: "merge_to_main",
    source: "merge",
    status: "merged",
    title: "Merge to Main",
    summary: "The passing fix branch merges back into main.",
    branch: "main",
    parentId: "dev-kane-failure",
    mergeParentIds: ["dev-kane-pass"],
    sequence: 10,
    actor: "OpenBranch",
    detail: [
      "GitHub tracks code history. OpenBranch tracks AI development history as ideas evolve through assumptions, experiments, verification, and ideas carried into main.",
    ],
  },
];

export function developmentEventColor(event?: DevelopmentEvent | null): string | null {
  if (!event) return null;
  return DEVELOPMENT_EVENT_COLORS[event.kind] || null;
}

export function developmentEventLabel(event: DevelopmentEvent): string {
  return SOURCE_LABEL[event.source] + " / " + STATUS_LABEL[event.status];
}

export function developmentEventStatusLabel(status: DevelopmentEventStatus): string {
  return STATUS_LABEL[status];
}

function eventActivityKind(event: DevelopmentEvent): CommitActivity["kind"] {
  if (event.status === "failed") return "error";
  if (event.kind === "kiro_plan" || event.kind === "kiro_spec" || event.kind === "kiro_task") return "planning";
  if (event.kind === "merge_to_main" || event.status === "passed") return "done";
  return "tool";
}

function eventActivityStatus(event: DevelopmentEvent): CommitActivity["status"] {
  return event.status === "failed" ? "error" : "done";
}

function responseForEvent(event: DevelopmentEvent): string {
  const lines = [`**${event.title}**`, event.summary];
  if (event.detail?.length) {
    lines.push(event.detail.map((item) => "- " + item).join("\n"));
  }
  if (event.kind === "merge_to_main") {
    lines.push("**Demo story:** GitHub tracks code history. OpenBranch tracks AI development history as ideas evolve.");
  }
  return lines.join("\n\n");
}

function activityForEvent(event: DevelopmentEvent, ts: number): CommitActivity {
  return {
    id: event.id + "-activity",
    kind: eventActivityKind(event),
    label: developmentEventLabel(event),
    detail: event.summary,
    status: eventActivityStatus(event),
    source: event.source,
    startedAt: ts,
    endedAt: ts + 450,
    durationMs: 450,
  };
}

const DEVELOPMENT_EVENT_TO_COMMON_TYPE: Record<DevelopmentEventKind, CommonDevelopmentEvent["type"]> = {
  user_goal: "goal",
  kiro_plan: "plan",
  kiro_spec: "spec",
  kiro_task: "task",
  kiro_build_attempt: "build_attempt",
  kane_verify: "verify",
  kane_failure: "fail",
  ai_fix_branch: "fix_branch",
  kane_pass: "pass",
  merge_to_main: "merge",
};

function developmentEventToCommonEvent(event: DevelopmentEvent, timestamp: string): CommonDevelopmentEvent {
  const source = event.source === "ai" ? "agent" : event.source;
  return {
    id: event.id,
    timestamp,
    source,
    type: DEVELOPMENT_EVENT_TO_COMMON_TYPE[event.kind],
    status: event.status,
    label: event.title,
    parentId: event.parentId,
    branchId: event.branch,
    summary: event.summary,
    detail: event.detail,
    mergeParentIds: event.mergeParentIds,
    metadata: {
      ...(event.metadata || {}),
      actor: event.actor,
      demoEventKind: event.kind,
    },
  };
}

export function developmentEventsToCommits(
  events: DevelopmentEvent[],
  options: { baseTs?: number; stepMs?: number; view?: DevelopmentGraphView } = {},
): Commit[] {
  const baseTs = options.baseTs ?? Date.now();
  const stepMs = options.stepMs ?? 1000;
  if ((options.view || "story") === "story") {
    const commonEvents = events
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((event, index) => {
        const ts = baseTs + index * stepMs;
        return developmentEventToCommonEvent(event, event.at ?? new Date(ts).toISOString());
      });
    return commonEventsToCommits(commonEvents, { view: "story" });
  }

  return events
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((event, index) => {
      const ts = baseTs + index * stepMs;
      const normalizedEvent: DevelopmentEvent = {
        ...event,
        at: event.at ?? new Date(ts).toISOString(),
      };

      return {
        id: event.id,
        parentId: event.parentId,
        mergeIds: event.mergeParentIds || [],
        branch: event.branch,
        ts,
        prompt: event.title,
        response: responseForEvent(event),
        model: event.actor,
        mode: "code",
        activities: [activityForEvent(event, ts)],
        developmentEvent: normalizedEvent,
        displayLabel: event.title,
      };
    });
}

export type KiroHookPayload = {
  id?: string;
  phase?: "plan" | "build";
  title?: string;
  summary?: string;
  parentId?: CommitId | null;
  branch?: string;
  files?: string[];
  metadata?: Record<string, unknown>;
};

export function kiroHookToDevelopmentEvent(
  payload: KiroHookPayload,
  context: { sequence: number; parentId?: CommitId | null; branch?: string } = { sequence: 1 },
): DevelopmentEvent {
  const phase = payload.phase === "build" ? "build" : "plan";
  const kind: DevelopmentEventKind = phase === "build" ? "kiro_build_attempt" : "kiro_plan";
  return {
    id: payload.id || "kiro-" + phase + "-" + context.sequence,
    kind,
    source: "kiro",
    status: phase === "build" ? "building" : "planned",
    title: payload.title || (phase === "build" ? "Kiro Build Attempt" : "Kiro Plan"),
    summary: payload.summary || "Kiro emitted a " + phase + " event.",
    branch: payload.branch || context.branch || "main",
    parentId: payload.parentId ?? context.parentId ?? null,
    sequence: context.sequence,
    actor: "Kiro",
    detail: payload.files?.length ? ["Files: " + payload.files.join(", ")] : undefined,
    metadata: payload.metadata,
  };
}

export function kaneNdjsonToDevelopmentEvent(
  line: string | Record<string, unknown>,
  context: { sequence: number; parentId?: CommitId | null; branch?: string } = { sequence: 1 },
): DevelopmentEvent | null {
  const row = typeof line === "string" ? JSON.parse(line) : line;
  const rawStatus = String(row.status || row.outcome || row.type || "").toLowerCase();
  const failed = rawStatus.includes("fail") || rawStatus.includes("error");
  const passed = rawStatus.includes("pass") || rawStatus.includes("success") || rawStatus.includes("ok");
  const kind: DevelopmentEventKind = failed ? "kane_failure" : passed ? "kane_pass" : "kane_verify";
  const status: DevelopmentEventStatus = failed ? "failed" : passed ? "passed" : "verifying";

  return {
    id: String(row.id || "kane-" + status + "-" + context.sequence),
    kind,
    source: "kane",
    status,
    title: String(row.title || (failed ? "Kane Failure" : passed ? "Kane Pass" : "Kane Verify")),
    summary: String(row.summary || row.message || "Kane emitted a " + status + " event."),
    branch: String(row.branch || context.branch || "main"),
    parentId: (row.parentId as CommitId | null | undefined) ?? context.parentId ?? null,
    sequence: Number(row.sequence || context.sequence),
    actor: "Kane",
    metadata: row,
  };
}
