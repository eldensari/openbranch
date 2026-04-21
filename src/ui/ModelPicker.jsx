import { useState } from "react";

export default function ModelPicker({ models, value, onChange, thinking, onThinkingChange, t }) {
  const [open, setOpen] = useState(false);
  const current = models.find(m => m.id === value) || models[0];
  const hasThinking = current?.thinking;
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ padding: "4px 10px", fontSize: 11, fontWeight: 500, borderRadius: 6, border: "none", background: "transparent", color: t.textSub, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
        onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        {current?.label}
        {hasThinking && thinking && <span style={{ fontSize: 9, color: t.textMuted, marginLeft: 2 }}>Thinking</span>}
        <span style={{ fontSize: 8, color: t.textMuted }}>{"▾"}</span>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 50 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, bottom: "calc(100% + 4px)", zIndex: 60, background: t.bg, border: "0.5px solid " + t.border, borderRadius: 10, boxShadow: "0 6px 20px rgba(0,0,0,0.12)", padding: "6px", minWidth: 240 }}>
            {models.map(m => {
              const active = m.id === value;
              return (
                <div key={m.id} onClick={() => { onChange(m.id); setOpen(false); }}
                  style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: t.text }}>{m.label}</div>
                    {m.desc && <div style={{ fontSize: 10, color: t.textSub, marginTop: 1 }}>{m.desc}</div>}
                  </div>
                  {active && <span style={{ color: "#378ADD", fontSize: 12 }}>{"✓"}</span>}
                </div>
              );
            })}
            {hasThinking && (
              <>
                <div style={{ height: 1, background: t.border, margin: "4px 2px" }} />
                <div onClick={() => onThinkingChange(!thinking)}
                  style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                  onMouseEnter={e => e.currentTarget.style.background = t.hoverSidebar} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: t.text }}>Thinking</div>
                    <div style={{ fontSize: 10, color: t.textSub, marginTop: 1 }}>Thinks for more complex tasks</div>
                  </div>
                  <div style={{ width: 30, height: 16, borderRadius: 10, background: thinking ? "#378ADD" : t.border, position: "relative", transition: "background 0.15s" }}>
                    <div style={{ position: "absolute", top: 2, left: thinking ? 16 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
