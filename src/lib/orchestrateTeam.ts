import type { AgentRole } from "@/types";
import { detectProvider, MODEL_CHOICES } from "./llm";

export const ROLE_SYSTEM_PROMPTS: Record<AgentRole, string> = {
  master:
    "You are the Master coordinator on an AI validation team. Speak to the user briefly and plainly in English, the way you'd explain a technical situation to a non-engineer.",
  executor:
    "You are the Executor on an AI validation team. Generate the most direct, useful answer to the user's request. Be confident and complete. Do NOT add validation caveats — that's another agent's job. If the request is code, write working code.",
  validator:
    "You are the Validator on an AI validation team. You will be shown another agent's answer (the Executor's). Your job is to fact-check it. Verify any libraries, APIs, function names, or claims that can be checked. Output exactly one line of verdict at the top: VERIFIED, UNVERIFIED, or PARTIAL — followed by a short explanation (1-3 sentences). If you find unverifiable claims (e.g. non-existent packages), say so explicitly with the safer alternative.",
  critic:
    "You are the Critic on an AI validation team. You will be shown another agent's answer (the Executor's). Find weaknesses, edge cases, runtime failures, and missing context. Output exactly one line of verdict at the top: APPROVE, REJECT, or WARN — followed by a short explanation (1-3 sentences). If the code or answer would fail to run / install / compile, say REJECT with the specific failure.",
};

export const ROLE_LABELS: Record<AgentRole, string> = {
  master: "Master",
  executor: "Executor",
  validator: "Validator",
  critic: "Critic",
};

export type RoleAssignment = {
  role: AgentRole;
  apiKey: string;
  model: string;
  provider: string;
};

/**
 * Assign roles to providers.
 *
 * If multiple keys are configured (e.g. an Anthropic, an OpenAI, and a Gemini key
 * stored separately), pick distinct providers for Executor/Validator/Critic.
 * Otherwise repeat the primary key for all roles.
 */
export function assignRoles(
  primaryKey: string,
  extraKeys: string[] = [],
  preferredModel?: string,
): Record<AgentRole, RoleAssignment> {
  const all = [primaryKey, ...extraKeys].filter((k) => k && k.trim());
  const providers = all
    .map((k) => ({ key: k, p: detectProvider(k) }))
    .filter((x) => x.p);

  const primary = providers[0];
  const pickFor = (idx: number) => {
    if (!providers.length) {
      return { key: primaryKey, providerId: "free", model: preferredModel || "claude-sonnet-4-20250514" };
    }
    const chosen = providers[idx % providers.length];
    const list = MODEL_CHOICES[chosen.p!.id] || [];
    const model =
      idx === 0 && preferredModel && list.some((m) => m.id === preferredModel)
        ? preferredModel
        : list[0]?.id || preferredModel || "";
    return { key: chosen.key, providerId: chosen.p!.id, model };
  };

  const masterPick = pickFor(0);
  const executorPick = pickFor(0);
  const validatorPick = pickFor(1);
  const criticPick = pickFor(2);

  return {
    master: {
      role: "master",
      apiKey: masterPick.key,
      model: masterPick.model,
      provider: masterPick.providerId,
    },
    executor: {
      role: "executor",
      apiKey: executorPick.key,
      model: executorPick.model,
      provider: executorPick.providerId,
    },
    validator: {
      role: "validator",
      apiKey: validatorPick.key,
      model: validatorPick.model,
      provider: validatorPick.providerId,
    },
    critic: {
      role: "critic",
      apiKey: criticPick.key,
      model: criticPick.model,
      provider: criticPick.providerId,
    },
  };
}

export const MASTER_DELEGATION_TEXT = "🟣 Team lead activated. Delegating to Executor...";
export const MASTER_INTERMEDIATE_TEXT = "Draft received. Invoking Validator and Critic...";

export function buildMasterRunningResponse(stage: "delegating" | "validating"): string {
  if (stage === "delegating") {
    return MASTER_DELEGATION_TEXT;
  }
  return MASTER_DELEGATION_TEXT + "\n\n" + MASTER_INTERMEDIATE_TEXT;
}

export function buildValidatorPrompt(userQuestion: string, executorAnswer: string): string {
  return (
    "User question:\n" +
    userQuestion +
    "\n\n---\n\nExecutor's answer (verify this):\n\n" +
    executorAnswer +
    "\n\n---\n\nProvide your verdict line + reasoning."
  );
}

export function buildCriticPrompt(userQuestion: string, executorAnswer: string): string {
  return (
    "User question:\n" +
    userQuestion +
    "\n\n---\n\nExecutor's answer (critique this):\n\n" +
    executorAnswer +
    "\n\n---\n\nProvide your verdict line + reasoning."
  );
}

export type SynthesisInput = {
  userQuestion: string;
  executorAnswer: string;
  executorModel: string;
  validatorAnswer: string;
  validatorModel: string;
  criticAnswer: string;
  criticModel: string;
};

// ── R3: Branch+Merge Architecture — per-worker Review (merge) + Execute prompts ──

const WORKER_R2_REVIEW_FORMAT =
  "Output: 3-5 bullets capturing what you understood from R1, and your strategy for round 2. Do NOT produce the final answer yet — only the plan.";

export function buildWorkerR2ReviewPrompt(
  role: AgentRole,
  r1OwnOutput: string,
  r1TeamSynthesis: string,
): string {
  const roleNote =
    role === "executor"
      ? "Your job in R2: replace your R1 answer with one that satisfies the team's R1 concerns."
      : role === "validator"
        ? "Your job in R2: re-assess what you flagged in R1, given the team has now produced a consensus on the fix direction."
        : "Your job in R2: re-assess what you flagged in R1, given the team has now produced a consensus on the fix direction.";
  return (
    "You are the " +
    ROLE_LABELS[role] +
    " on an AI validation team, ROUND 2 PLANNING phase. " +
    "You are seeing TWO inputs and nothing else.\n\n" +
    "--- Input A: your own ROUND 1 output ---\n" +
    r1OwnOutput +
    "\n\n--- Input B: the team's ROUND 1 synthesis (Master merge of all 3 workers) ---\n" +
    r1TeamSynthesis +
    "\n\n--- Task ---\n" +
    roleNote +
    "\n" +
    WORKER_R2_REVIEW_FORMAT
  );
}

export function buildWorkerR2ExecutePrompt(
  role: AgentRole,
  userPrompt: string,
  ownR2ReviewText: string,
): string {
  const roleAction =
    role === "executor"
      ? "Produce the CORRECTED answer that follows your plan. Working code or a complete answer, no caveats."
      : role === "validator"
        ? "Produce your ROUND 2 verdict line (VERIFIED, UNVERIFIED, or PARTIAL) followed by 1-3 sentences of reasoning. Compare R1 → R2."
        : "Produce your ROUND 2 verdict line (APPROVE, REJECT, or WARN) followed by 1-3 sentences of reasoning. Compare R1 → R2.";
  return (
    "You are the " +
    ROLE_LABELS[role] +
    " on an AI validation team, ROUND 2 EXECUTE phase. " +
    "You are seeing TWO inputs and nothing else.\n\n" +
    "--- Input A: original user request ---\n" +
    userPrompt +
    "\n\n--- Input B: your own R2 review plan ---\n" +
    ownR2ReviewText +
    "\n\n--- Task ---\n" +
    roleAction
  );
}

export type R2SynthesisInput = {
  userQuestion: string;
  r2ExecutorOutput: string;
  r2ValidatorOutput: string;
  r2CriticOutput: string;
  r1Synthesis: string;
  executorModel: string;
  validatorModel: string;
  criticModel: string;
};

export function buildR2MergeSynthesisPrompt(s: R2SynthesisInput): string {
  return (
    "You are the Master coordinator. The team just finished ROUND 2. " +
    "Write a SHORT round-2 report in plain English comparing Round 1 vs Round 2. The user did NOT see the sub-agent branches.\n\n" +
    "--- Original user request ---\n" + s.userQuestion +
    "\n\n--- Round 1 team synthesis (what you reported before) ---\n" + s.r1Synthesis +
    "\n\n--- Round 2 Executor (" + s.executorModel + ") corrected answer ---\n" + s.r2ExecutorOutput +
    "\n\n--- Round 2 Validator (" + s.validatorModel + ") verdict ---\n" + s.r2ValidatorOutput +
    "\n\n--- Round 2 Critic (" + s.criticModel + ") verdict ---\n" + s.r2CriticOutput +
    "\n\n--- Write the round-2 report in English using EXACTLY this format ---\n\n" +
    "✅ Round 2 Review Complete\n" +
    "- Change: <what was fixed from Round 1 → Round 2, one line>\n" +
    "- Validator R2: <verdict + one-line R1→R2 comparison>\n" +
    "- Critic R2: <verdict + one-line R1→R2 comparison>\n" +
    "→ Verified Final Answer: <the verified answer; if code, one block only; if still unresolved, the reason>\n\n" +
    "If BOTH Validator R2 (VERIFIED) AND Critic R2 (APPROVE), include this line at the end:\n" +
    "🎯 Round 1 hallucination → Round 2 corrected. Branch + merge IS the memory."
  );
}

export const EXECUTOR_REVIEW_SYSTEM =
  "You are the Executor on an AI validation team. You just produced an answer that the team flagged. " +
  "Read the team's feedback carefully and PLAN a fix in 3-5 concise bullet points. " +
  "Do NOT rewrite code yet. Just the plan. End with a one-line decision: 'Plan: <strategy summary>'.";

export const EXECUTOR_TASK_SYSTEM =
  "You are the Executor on an AI validation team. You have a verified fix plan from your prior review step. " +
  "Now produce the CORRECTED version of the answer to the original user request. " +
  "Follow the plan strictly. If the plan said to use a different API/library, USE THAT — do not regress to the original mistake.";

export const VALIDATOR_R2_SYSTEM =
  "You are the Validator on an AI validation team, ROUND 2. You will be shown the Executor's NEW (corrected) output, " +
  "alongside the specific concern YOU raised in round 1. Your job: verify whether your round-1 concern is fully addressed. " +
  "Output exactly one line of verdict at the top: VERIFIED, UNVERIFIED, or PARTIAL — followed by a short comparison (R1→R2).";

export const CRITIC_R2_SYSTEM =
  "You are the Critic on an AI validation team, ROUND 2. You will be shown the Executor's NEW (corrected) output, " +
  "alongside the specific weakness YOU raised in round 1. Your job: verify whether your round-1 critique is addressed. " +
  "Output exactly one line of verdict at the top: APPROVE, REJECT, or WARN — followed by a short comparison (R1→R2).";

export function buildExecutorReviewPrompt(
  executorAnswer: string,
  validatorVerdict: string,
  criticVerdict: string,
): string {
  return (
    EXECUTOR_REVIEW_SYSTEM +
    "\n\n--- Your round-1 answer ---\n" +
    executorAnswer +
    "\n\n--- Team feedback ---\n" +
    "Validator: " +
    validatorVerdict +
    "\n\nCritic: " +
    criticVerdict +
    "\n\n--- Now: write your fix plan in 3-5 bullets. No code yet. ---"
  );
}

export function buildExecutorTaskPrompt(userPrompt: string, reviewPlan: string): string {
  return (
    EXECUTOR_TASK_SYSTEM +
    "\n\n--- Original user request ---\n" +
    userPrompt +
    "\n\n--- Your verified fix plan ---\n" +
    reviewPlan +
    "\n\n--- Now: produce the CORRECTED version. Follow the plan strictly. ---"
  );
}

export function buildValidatorR2Prompt(
  userPrompt: string,
  newOutput: string,
  r1ValidatorVerdict: string,
): string {
  return (
    VALIDATOR_R2_SYSTEM +
    "\n\n--- Original user request ---\n" +
    userPrompt +
    "\n\n--- Executor's NEW (round-2) output ---\n" +
    newOutput +
    "\n\n--- Your round-1 concern (what you flagged) ---\n" +
    r1ValidatorVerdict +
    "\n\n--- Verdict line + R1→R2 comparison ---"
  );
}

export function buildCriticR2Prompt(
  userPrompt: string,
  newOutput: string,
  r1CriticVerdict: string,
): string {
  return (
    CRITIC_R2_SYSTEM +
    "\n\n--- Original user request ---\n" +
    userPrompt +
    "\n\n--- Executor's NEW (round-2) output ---\n" +
    newOutput +
    "\n\n--- Your round-1 critique (what you flagged) ---\n" +
    r1CriticVerdict +
    "\n\n--- Verdict line + R1→R2 comparison ---"
  );
}

export type SynthesisR2Input = {
  userQuestion: string;
  r1ExecutorAnswer: string;
  r2ExecutorAnswer: string;
  r1ValidatorVerdict: string;
  r2ValidatorVerdict: string;
  r1CriticVerdict: string;
  r2CriticVerdict: string;
  executorModel: string;
  validatorModel: string;
  criticModel: string;
};

export function buildSynthesisR2Prompt(s: SynthesisR2Input): string {
  return (
    "You are the Master coordinator. The team just ran ROUND 2 to fix the issues from round 1. " +
    "Write a SHORT round-2 report in plain English comparing Round 1 vs Round 2. The user did NOT see the sub-agent branches.\n\n" +
    "User's original question:\n" + s.userQuestion +
    "\n\n--- Round 1 Executor (" + s.executorModel + ") ---\n" + s.r1ExecutorAnswer +
    "\n\n--- Round 1 Validator (" + s.validatorModel + ") ---\n" + s.r1ValidatorVerdict +
    "\n\n--- Round 1 Critic (" + s.criticModel + ") ---\n" + s.r1CriticVerdict +
    "\n\n--- Round 2 Executor (" + s.executorModel + ", corrected) ---\n" + s.r2ExecutorAnswer +
    "\n\n--- Round 2 Validator (" + s.validatorModel + ") ---\n" + s.r2ValidatorVerdict +
    "\n\n--- Round 2 Critic (" + s.criticModel + ") ---\n" + s.r2CriticVerdict +
    "\n\n--- Write the round-2 report in English using EXACTLY this format ---\n\n" +
    "✅ Round 2 Review Complete\n" +
    "- Round 1 → Round 2 change: <what was fixed, one line>\n" +
    "- Validator R2: <verdict + one-line R1→R2 comparison>\n" +
    "- Critic R2: <verdict + one-line R1→R2 comparison>\n" +
    "→ Verified Final Answer: <the verified answer, or the reason it's still unresolved; if code, one block only>\n\n" +
    "If BOTH Validator R2 and Critic R2 approve (VERIFIED + APPROVE), include this line at the end:\n" +
    "🎯 Memory-based learning demonstrated — Round 1 hallucination → Round 2 corrected."
  );
}

export function buildSynthesisPrompt(s: SynthesisInput): string {
  return (
    "You are the Master coordinator. Synthesize the team's findings into a SHORT report in plain English for the user. " +
    "Speak as the team lead. The user did NOT see the sub-agent branches; you summarize.\n\n" +
    "User's original question:\n" +
    s.userQuestion +
    "\n\n---\n\nExecutor (" +
    s.executorModel +
    ") answer:\n" +
    s.executorAnswer +
    "\n\n---\n\nValidator (" +
    s.validatorModel +
    ") verdict:\n" +
    s.validatorAnswer +
    "\n\n---\n\nCritic (" +
    s.criticModel +
    ") verdict:\n" +
    s.criticAnswer +
    "\n\n---\n\nWrite the final synthesis in English using EXACTLY this format:\n\n" +
    "✅ Team Review Complete\n" +
    "- Executor (" +
    s.executorModel +
    "): <one-line summary>\n" +
    "- Validator (" +
    s.validatorModel +
    "): <verdict + one-line reasoning>\n" +
    "- Critic (" +
    s.criticModel +
    "): <verdict + one-line reasoning>\n" +
    "→ Verified Final Answer: <the verified content, or the reason for rejection; if code, one block only>\n\n" +
    "If both Validator and Critic flag a hallucination (e.g. non-existent library), the header line MUST be:\n" +
    "🛑 Team Detected Hallucination.\n" +
    "...and the Verified Final Answer must provide the safe alternative."
  );
}
