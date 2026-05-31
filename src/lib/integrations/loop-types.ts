import type { CommonDevelopmentEvent } from "@/types";

export type LoopAction =
  | "run_kane_verification"
  | "ingest_kane_result"
  | "generate_kiro_next_action"
  | "mark_idea_accepted"
  | "export_codex_goal";

export type IntegrationSurface = {
  name: "kiro" | "kane" | "codex" | "file_bridge";
  available: boolean;
  mode: "api" | "cli" | "env_command" | "desktop" | "file_bridge" | "kane_power" | "fixture";
  command?: string;
  notes: string;
};

export type LoopArtifact = {
  path: string;
  filename: string;
  content: string;
  mime: string;
};

export type LoopCommand = {
  label: string;
  command: string;
};

export type LoopContext = {
  goal: string;
  featureKey: string;
  featureTitle: string;
  branch: string;
  behavior: string;
  eventsFile?: string;
};

export type LoopStepResult = {
  label: string;
  summary: string;
  artifacts?: LoopArtifact[];
  commands?: LoopCommand[];
  events?: CommonDevelopmentEvent[];
};
