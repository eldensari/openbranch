import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-resizable-panels")) return "resizable";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("@radix-ui/react-dialog") || id.includes("@radix-ui/react-alert-dialog")) return "radix-dialog";
          if (id.includes("@radix-ui/react-dropdown-menu") || id.includes("@radix-ui/react-context-menu") || id.includes("@radix-ui/react-popover") || id.includes("@radix-ui/react-tooltip")) return "radix-popover";
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
