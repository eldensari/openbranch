import type { AgentRole } from "@/types";

const ROLE_META: Record<
  AgentRole,
  { emoji: string; label: string; bg: string; fg: string; border: string }
> = {
  master: {
    emoji: "🟣",
    label: "Master",
    bg: "rgba(127, 119, 221, 0.12)",
    fg: "#5B4FC0",
    border: "#7F77DD",
  },
  executor: {
    emoji: "🟢",
    label: "Executor",
    bg: "rgba(29, 158, 117, 0.12)",
    fg: "#137A55",
    border: "#1D9E75",
  },
  validator: {
    emoji: "🟡",
    label: "Validator",
    bg: "rgba(186, 117, 23, 0.14)",
    fg: "#8A5710",
    border: "#BA7517",
  },
  critic: {
    emoji: "🔴",
    label: "Critic",
    bg: "rgba(216, 90, 48, 0.14)",
    fg: "#A4421F",
    border: "#D85A30",
  },
};

export function roleColor(role: AgentRole | undefined | null): string | null {
  if (!role) return null;
  return ROLE_META[role]?.border ?? null;
}

type Props = {
  role: AgentRole;
  model?: string | null;
  className?: string;
  compact?: boolean;
};

export default function RoleBadge({ role, model, className, compact }: Props) {
  const meta = ROLE_META[role];
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        padding: compact ? "1px 6px" : "2px 8px",
        borderRadius: 999,
        background: meta.bg,
        color: meta.fg,
        border: `1px solid ${meta.border}`,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: compact ? 9 : 10 }}>{meta.emoji}</span>
      <span>{meta.label}</span>
      {model ? (
        <span style={{ opacity: 0.7, fontWeight: 500 }}>· {model}</span>
      ) : null}
    </span>
  );
}
