import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDevelopmentEventAdapter } from "./scripts/development-event-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function developmentEventAdapterPlugin() {
  return {
    name: "openbranch-development-event-adapter",
    configureServer(server) {
      const adapter = createDevelopmentEventAdapter({
        rootDir: __dirname,
        eventsFile: path.resolve(__dirname, "events.jsonl"),
      });

      adapter.start();
      server.httpServer?.once("close", () => adapter.stop());
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/events.jsonl")) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(adapter.readEventsText());
      });
    },
  };
}

export default defineConfig({
  plugins: [developmentEventAdapterPlugin(), react(), tailwindcss()],
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
