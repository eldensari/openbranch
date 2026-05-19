export type CommitId = string;

export type AgentRole = "master" | "executor" | "validator" | "critic";

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
