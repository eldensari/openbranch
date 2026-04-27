import { useState, useRef, useEffect } from "react";
import storage from "../lib/storage";

export function useSidebarUI() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((v) => !v);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(storage.get("sidebarWidth")?.value);
    return Number.isFinite(saved) && saved >= 200 && saved <= 480 ? saved : 280;
  });
  const sidebarDrag = useRef<{ startX: number; startW: number } | null>(null);
  const onSidebarResizeDown = (e: React.MouseEvent) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    sidebarDrag.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (me: MouseEvent) => {
      if (!sidebarDrag.current) return;
      const dx = me.clientX - sidebarDrag.current.startX;
      const next = Math.min(480, Math.max(200, sidebarDrag.current.startW + dx));
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (sidebarDrag.current) storage.set("sidebarWidth", String(sidebarWidth));
      sidebarDrag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useEffect(() => {
    if (!sidebarCollapsed) storage.set("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth, sidebarCollapsed]);

  return { sidebarCollapsed, toggleSidebar, sidebarWidth, sidebarDrag, onSidebarResizeDown };
}
