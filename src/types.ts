export type CommitId = string;

export type AgentRole = "master" | "executor" | "validator" | "critic";

export type DevelopmentEventSource = "user" | "kiro" | "kane" | "ai" | "merge";

export type DevelopmentEventStatus =
  | "goal"
  | "planned"
  | "specified"
  | "tasked"
  | "building"
  | "verifying"
  | "failed"
  | "branching"
  | "passed"
  | "merged";

export type DevelopmentEventKind =
  | "user_goal"
  | "kiro_plan"
  | "kiro_spec"
  | "kiro_task"
  | "kiro_build_attempt"
  | "kane_verify"
  | "kane_failure"
  | "ai_fix_branch"
  | "kane_pass"
  | "merge_to_main";

export type DevelopmentEvent = {
  id: CommitId;
  kind: DevelopmentEventKind;
  source: DevelopmentEventSource;
  status: DevelopmentEventStatus;
  title: string;
  summary: string;
  branch: string;
  parentId: CommitId | null;
  mergeParentIds?: CommitId[];
  sequence: number;
  actor?: string;
  at?: string;
  detail?: string[];
  metadata?: Record<string, unknown>;
};

export type CommonDevelopmentEventSource = "user" | "codex" | "kiro" | "kane" | "agent" | "merge" | "system";

export type SemanticDevelopmentEventType =
  | "session"
  | "goal"
  | "plan"
  | "spec"
  | "task"
  | "feature_branch"
  | "episode"
  | "build_attempt"
  | "verify"
  | "fail"
  | "pass"
  | "fix_branch"
  | "merge";

export type CommonDevelopmentEvent = {
  id: string;
  timestamp: string;
  source: CommonDevelopmentEventSource;
  type: string;
  status: string;
  label: string;
  parentId: string | null;
  branchId: string;
  summary?: string;
  detail?: string[];
  files?: string[];
  rawEventIds?: string[];
  mergeParentIds?: string[];
  intent?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type Attachment = {
  type: "image" | "pdf";
  mediaType: string;
  name: string;
  data?: string;
  ref?: string;
};

export type WebReference = {
  kind?: "web";
  url: string;
  title: string;
  snippet?: string;
};

export type FileReference = {
  kind: "file";
  path: string;
  line?: number;
  snippet?: string;
};

export type CommitReference = {
  kind: "commit";
  sha: string;
  message?: string;
};

export type Reference = WebReference | FileReference | CommitReference;

// Back-compat alias — existing stored data without `kind` is still a valid web reference.
export type Citation = WebReference;

export type ResponseBlock = {
  text: string;
  citations?: Citation[];
};

export type CommitActivityKind =
  | "thinking"
  | "planning"
  | "searching"
  | "writing"
  | "source"
  | "tool"
  | "done"
  | "error";

export type CommitActivityStatus = "pending" | "running" | "done" | "error";

export type CommitActivity = {
  id: string;
  kind: CommitActivityKind;
  label: string;
  detail?: string;
  status: CommitActivityStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  source?: string;
};

export type CommitEvent =
  | {
      type: "thinking";
      text: string;
      startedAt?: number;
      endedAt?: number;
      durationMs?: number;
    }
  | {
      type: "text";
      content: string;
    }
  | {
      type: "tool_use";
      tool: string;
      input?: unknown;
      status: "pending" | "running" | "done" | "error";
      output?: unknown;
      summary?: string;
      startedAt?: number;
      endedAt?: number;
      durationMs?: number;
    }
  | {
      type: "reference";
      ref: Reference;
    };

export type Commit = {
  id: CommitId;
  parentId: CommitId | null;
  mergeIds?: CommitId[];
  branch: string;
  ts: number;
  prompt: string;
  response: string;
  model?: string;
  mode?: "chat" | "code";
  thinking?: {
    text?: string;
    startedAt?: number;
    finishedAt?: number;
    durationMs?: number;
  };
  ratelimitExceeded?: boolean;
  editing?: boolean;
  rewriting?: boolean;
  locked?: boolean;
  loading?: boolean;
  attachments?: Attachment[];
  citations?: Citation[];
  responseBlocks?: ResponseBlock[];
  activities?: CommitActivity[];
  events?: CommitEvent[];
  webSearch?: boolean;
  role?: AgentRole;
  provider?: string;
  verdict?: string;
  iteration?: number;
  developmentEvent?: DevelopmentEvent;
  liveEvent?: CommonDevelopmentEvent;
  storyTechnicalDetails?: string;
  displayLabel?: string;
  tags?: string[];
  // Round 2 sub-roles for executor (kept on the same `role: "executor"` so badges color the same)
  executorPhase?: "draft" | "review" | "task";
  // For tracking which R1 commit a R2 commit refines (so graph can show lineage)
  refinesId?: string;
};

export type Conversation = {
  id: string;
  title: string;
  commits: Commit[];
  headId: CommitId | null;
  branch: string;
  parentRef?: { convId: string; commitId: CommitId; [k: string]: unknown } | null;
  u?: string;
  clusterId?: string | null;
  createdAt?: string;
  branchTitles?: Record<string, string>;
  labels?: string[];
};

export type Folder = {
  id: string;
  name: string;
  convIds: string[];
  parentId?: string | null;
  expanded?: boolean;
};

export type Tag = {
  id: string;
  name: string;
  color?: string;
};

export type Theme = "light" | "dark";
