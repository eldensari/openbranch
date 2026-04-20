/* ═══════ THEME ═══════ */
export const LIGHT = {
  bg: "#fff", sidebar: "#f8f8f5", border: "#ddd", text: "#111", textSub: "#888", textMuted: "#aaa",
  chatBg: "#fff", userBubble: "#e6f1fb", userText: "#185fa5", aiBubble: "#f5f5f0", aiText: "#111",
  mergeBubble: "#fef9ef", mergeText: "#854F0B", accent: "#1A1A2E", accentText: "#fff",
  graphBg: "#f8f8f5", hover: "#fff", hoverSidebar: "#f5f5f0", codeBg: "#1e1e2e", codeText: "#cdd6f4",
  inlineCode: "#e8e8e4",
};
export const DARK = {
  bg: "#1a1a2e", sidebar: "#16162a", border: "#2a2a4a", text: "#e0e0e0", textSub: "#888", textMuted: "#666",
  chatBg: "#1a1a2e", userBubble: "#1e3a5f", userText: "#7db8f0", aiBubble: "#242444", aiText: "#d0d0d0",
  mergeBubble: "#3a2a10", mergeText: "#f0c060", accent: "#3a3a6e", accentText: "#fff",
  graphBg: "#16162a", hover: "#242444", hoverSidebar: "#1e1e3a", codeBg: "#0e0e1e", codeText: "#cdd6f4",
  inlineCode: "#2a2a4a",
};

/* ═══════ COLORS ═══════ */
export const BC = ["#1D9E75", "#378ADD", "#D85A30", "#D4537E", "#7F77DD", "#BA7517", "#E24B4A", "#639922"];
export function bCol(names, b) { return BC[names.indexOf(b) % BC.length] || "#888"; }
