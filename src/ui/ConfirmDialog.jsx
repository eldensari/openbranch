export default function ConfirmDialog({ dialog, onClose, t }) {
  if (!dialog) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: t.bg, border: "0.5px solid " + t.border, borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.2)", padding: "18px 20px", minWidth: 280, maxWidth: 380 }}>
        <div style={{ fontSize: 13, color: t.text, marginBottom: 16, lineHeight: 1.45 }}>{dialog.msg}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "7px 14px", fontSize: 11, borderRadius: 6, background: "transparent", border: "0.5px solid " + t.border, cursor: "pointer", color: t.textSub }}>Cancel</button>
          <button onClick={() => { dialog.onConfirm?.(); onClose(); }}
            style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, borderRadius: 6, background: "#c00", color: "#fff", border: "none", cursor: "pointer" }}>Delete</button>
        </div>
      </div>
    </div>
  );
}
