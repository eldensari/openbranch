import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDevelopmentEventAdapter } from "./scripts/development-event-adapter.mjs";
import { startTeamLoopSession } from "./scripts/team-loop-session.mjs";
import { startSelfImproveMockDemo } from "./scripts/openbranch-self-improve-mock.mjs";

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
      const readJsonBody = (req: any) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          let body = "";
          req.on("data", (chunk: Buffer | string) => {
            body += chunk.toString();
            if (body.length > 128_000) reject(new Error("Request body is too large."));
          });
          req.on("end", () => {
            try {
              resolve(body ? JSON.parse(body) : {});
            } catch {
              reject(new Error("Invalid JSON request body."));
            }
          });
          req.on("error", reject);
        });

      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api/openbranch/team-loop")) {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "Use POST." }));
            return;
          }

          readJsonBody(req)
            .then((body) => {
              const result = startTeamLoopSession({
                rootDir: __dirname,
                eventsFile: path.resolve(__dirname, "events.jsonl"),
                tmpDir: path.resolve(__dirname, ".tmp"),
                prompt: String(body.prompt || ""),
                reset: body.reset === true,
              });
              res.statusCode = 200;
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.setHeader("cache-control", "no-store");
              res.end(JSON.stringify(result));
            })
            .catch((error) => {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: error?.message || "Unable to start AI Team Loop." }));
            });
          return;
        }

        if (req.url?.startsWith("/api/openbranch/self-improve-mock")) {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "Use POST." }));
            return;
          }

          readJsonBody(req)
            .then((body) => {
              const result = startSelfImproveMockDemo({
                eventsFile: path.resolve(__dirname, "events.jsonl"),
                tmpDir: path.resolve(__dirname, ".tmp"),
                reset: body.reset === true,
                kaneTimeoutMs: 5_000,
                kaneMaxSteps: 2,
              });
              res.statusCode = 200;
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.setHeader("cache-control", "no-store");
              res.end(JSON.stringify(result));
            })
            .catch((error) => {
              res.statusCode = 500;
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ ok: false, error: error?.message || "Unable to start Mock Demo." }));
            });
          return;
        }

        if (req.url?.startsWith("/api/openbranch/self-improve-session")) {
          const sessionFile = path.resolve(__dirname, ".tmp", "openbranch-self-improve-session.json");
          const registryFile = path.resolve(__dirname, ".tmp", "openbranch-self-improve-sessions.json");
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          const readSessionFile = (file: string) => {
            try {
              return JSON.parse(fs.readFileSync(file, "utf8"));
            } catch {
              return null;
            }
          };
          const sessions: unknown[] = [];
          const registry = readSessionFile(registryFile);
          if (Array.isArray(registry?.sessions)) {
            for (const entry of registry.sessions) {
              const relative = typeof entry?.sessionFile === "string" ? entry.sessionFile : "";
              const file = relative ? path.resolve(__dirname, relative) : "";
              const session = file ? readSessionFile(file) : null;
              if (session) sessions.push(session);
            }
          }
          if (!sessions.length && fs.existsSync(sessionFile)) {
            const session = readSessionFile(sessionFile);
            if (session) sessions.push(session);
          }
          if (!sessions.length) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: "No self-improvement session has been recorded yet." }));
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, session: sessions[0], sessions }));
          return;
        }

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
    host: "127.0.0.1",
    port: 5173,
    watch: {
      ignored: ["**/events.jsonl", "**/.tmp/**"],
    },
  },
});
