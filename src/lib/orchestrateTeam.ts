import type { AgentRole } from "@/types";
import { detectProvider, MODEL_CHOICES } from "./llm";

export const ROLE_SYSTEM_PROMPTS: Record<AgentRole, string> = {
  master:
    "You are the Master coordinator on an AI validation team. You speak ONLY Korean to the user, briefly and plainly (5살 수준).",
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

export const MASTER_DELEGATION_TEXT = "🟣 팀장 호출됨. Executor에게 작업 분배 중...";
export const MASTER_INTERMEDIATE_TEXT = "초안 받았어요. Validator + Critic 호출 중...";

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

export function buildSynthesisPrompt(s: SynthesisInput): string {
  return (
    "You are the Master coordinator. Synthesize the team's findings into a SHORT report in plain Korean for the user. " +
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
    "\n\n---\n\nWrite the final synthesis in Korean using EXACTLY this format:\n\n" +
    "✅ 팀 검증 완료\n" +
    "- Executor (" +
    s.executorModel +
    "): <한 줄 요약>\n" +
    "- Validator (" +
    s.validatorModel +
    "): <verdict + 한 줄 이유>\n" +
    "- Critic (" +
    s.criticModel +
    "): <verdict + 한 줄 이유>\n" +
    "→ 검증된 최종 답: <검증된 내용 또는 거부 사유; 코드면 한 블록만 제시>\n\n" +
    "If both Validator and Critic flag a hallucination (e.g. non-existent library), the header line MUST be:\n" +
    "🛑 팀이 환각을 발견했습니다.\n" +
    "...and the 검증된 최종 답 must provide the verified safe alternative."
  );
}
