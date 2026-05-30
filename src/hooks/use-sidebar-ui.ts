import { useState, useRef, useEffect } from "react";
import storage from "../lib/storage";

const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 360;

const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));

export function useSidebarUI() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((v) => !v);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(storage.get("sidebarWidth")?.value);
    return Number.isFinite(saved) ? clampSidebarWidth(saved) : SIDEBAR_DEFAULT_WIDTH;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const sidebarDrag = useRef<{ startX: number; startW: number } | null>(null);
  const onSidebarResizeDown = (e: React.MouseEvent) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    sidebarDrag.current = { startX: e.clientX, startW: sidebarWidth };
    const onMove = (me: MouseEvent) => {
      if (!sidebarDrag.current) return;
      const dx = me.clientX - sidebarDrag.current.startX;
      const next = clampSidebarWidth(sidebarDrag.current.startW + dx);
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (sidebarDrag.current) storage.set("sidebarWidth", String(sidebarWidthRef.current));
      sidebarDrag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    if (!sidebarCollapsed) storage.set("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth, sidebarCollapsed]);

  return { sidebarCollapsed, toggleSidebar, sidebarWidth, sidebarDrag, onSidebarResizeDown };
}
