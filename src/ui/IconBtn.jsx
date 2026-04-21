export default function IconBtn({ children, title, onClick, disabled, t }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer", padding: 5, borderRadius: 6, color: t.textMuted, display: "flex", alignItems: "center", justifyContent: "center", opacity: disabled ? 0.4 : 1 }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = t.hoverSidebar; e.currentTarget.style.color = t.text; } }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.textMuted; }}>
      {children}
    </button>
  );
}
