import { useState } from "react";
import { neo4jBrowserUrl } from "@/lib/neo4j";

export type Neo4jBadgeState = {
  state: "idle" | "saving" | "saved" | "failed" | "disabled";
  error?: string;
  lastSessionId?: string;
};

type Props = {
  status: Neo4jBadgeState;
  onConfigChange?: () => void;
};

const COLORS = {
  idle: { bg: "rgba(120, 120, 130, 0.18)", fg: "#666", dot: "#888" },
  saving: { bg: "rgba(186, 117, 23, 0.18)", fg: "#8A5710", dot: "#BA7517" },
  saved: { bg: "rgba(29, 158, 117, 0.18)", fg: "#137A55", dot: "#1D9E75" },
  failed: { bg: "rgba(216, 90, 48, 0.18)", fg: "#A4421F", dot: "#D85A30" },
  disabled: { bg: "rgba(120, 120, 130, 0.10)", fg: "#888", dot: "#bbb" },
};

const LABELS: Record<Neo4jBadgeState["state"], { emoji: string; text: string }> = {
  idle: { emoji: "○", text: "Neo4j ready" },
  saving: { emoji: "⏳", text: "Saving to graph..." },
  saved: { emoji: "💾", text: "Saved to graph" },
  failed: { emoji: "⚠️", text: "Save failed" },
  disabled: { emoji: "○", text: "Neo4j not configured" },
};

export default function Neo4jBadge({ status, onConfigChange }: Props) {
  const [showConfig, setShowConfig] = useState(false);
  const [uri, setUri] = useState(() => {
    try {
      return localStorage.getItem("neo4j:uri") || "";
    } catch {
      return "";
    }
  });
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem("neo4j:user") || "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");

  const colors = COLORS[status.state];
  const { emoji, text } = LABELS[status.state];
  const browserUrl = neo4jBrowserUrl();

  const handleClick = () => {
    if (status.state === "saved" && browserUrl) {
      window.open(browserUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setShowConfig((p) => !p);
  };

  const saveConfig = () => {
    try {
      if (uri.trim()) localStorage.setItem("neo4j:uri", uri.trim());
      if (username.trim()) localStorage.setItem("neo4j:user", username.trim());
      if (password.trim()) localStorage.setItem("neo4j:pass", password.trim());
    } catch {
      /* ignore */
    }
    setShowConfig(false);
    onConfigChange?.();
  };

  const clearConfig = () => {
    try {
      localStorage.removeItem("neo4j:uri");
      localStorage.removeItem("neo4j:user");
      localStorage.removeItem("neo4j:pass");
    } catch {
      /* ignore */
    }
    setUri("");
    setUsername("");
    setPassword("");
    setShowConfig(false);
    onConfigChange?.();
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      {showConfig && (
        <div
          style={{
            background: "var(--popover)",
            color: "var(--popover-foreground)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            width: 320,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Neo4j Aura credentials</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="neo4j+s://xxxxx.databases.neo4j.io"
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--foreground)",
                fontSize: 12,
                fontFamily: "monospace",
              }}
            />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="neo4j"
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--foreground)",
                fontSize: 12,
              }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--background)",
                color: "var(--foreground)",
                fontSize: 12,
              }}
            />
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 6 }}>
            <button
              type="button"
              onClick={clearConfig}
              style={{
                fontSize: 11,
                color: "var(--muted-foreground)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "4px 8px",
              }}
            >
              Clear
            </button>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => setShowConfig(false)}
                style={{
                  fontSize: 11,
                  background: "var(--secondary)",
                  color: "var(--secondary-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveConfig}
                style={{
                  fontSize: 11,
                  background: "var(--primary)",
                  color: "var(--primary-foreground)",
                  border: "1px solid var(--primary)",
                  borderRadius: 6,
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
              >
                Save
              </button>
            </div>
          </div>
          {status.state === "failed" && status.error && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--destructive)" }}>
              {status.error}
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleClick}
        title={status.state === "saved" && browserUrl ? "Open Neo4j Browser" : "Configure Neo4j"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderRadius: 999,
          background: colors.bg,
          color: colors.fg,
          border: "1px solid " + colors.dot,
          fontSize: 11,
          fontWeight: 500,
          cursor: "pointer",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 3px 8px rgba(0,0,0,0.10)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.06)";
        }}
      >
        <span style={{ fontSize: 12 }}>{emoji}</span>
        <span>{text}</span>
        {status.state === "saving" && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: colors.dot,
              animation: "ob-team-pop-svg 0.8s ease-in-out infinite alternate",
            }}
          />
        )}
      </button>
    </div>
  );
}
