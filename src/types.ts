export type CommitId = string;

export type Attachment = {
  type: "image" | "pdf";
  mediaType: string;
  name: string;
  data?: string;
  ref?: string;
};

export type Citation = {
  url: string;
  title: string;
  snippet?: string;
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
  thinking?: boolean;
  ratelimitExceeded?: boolean;
  editing?: boolean;
  rewriting?: boolean;
  locked?: boolean;
  loading?: boolean;
  attachments?: Attachment[];
  citations?: Citation[];
  webSearch?: boolean;
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
