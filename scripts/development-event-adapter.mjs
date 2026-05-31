import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_IGNORES = new Set([
  ".git",
  ".vite",
  ".idea",
  ".claude",
  ".tmp",
  "node_modules",
  "dist",
  "build",
]);

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function eventTypeFor(status) {
  return "file." + status;
}

function labelFor(status, relPath) {
  const verb = status === "created" ? "Created" : status === "deleted" ? "Deleted" : "Modified";
  return verb + " " + relPath;
}

function readLastEventId(eventsFile) {
  try {
    const lines = fs.readFileSync(eventsFile, "utf8").trim().split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const row = JSON.parse(lines[i]);
        if (row?.id) return row.id;
      } catch {}
    }
  } catch {}
  return null;
}

function ensureEventsFile(eventsFile) {
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  if (!fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, "");
}

function shouldIgnore(relPath, eventsRelPath) {
  if (!relPath || relPath === eventsRelPath) return true;
  const parts = toPosixPath(relPath).split("/");
  if (parts.some((part) => DEFAULT_IGNORES.has(part))) return true;
  const base = parts[parts.length - 1] || "";
  return (
    base.endsWith(".log") ||
    base.endsWith(".err") ||
    base.endsWith(".out") ||
    base.endsWith(".tmp") ||
    base === "Thumbs.db" ||
    base === ".DS_Store"
  );
}

function scanFiles(rootDir, eventsRelPath) {
  const files = new Map();
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = toPosixPath(path.relative(rootDir, fullPath));
      if (shouldIgnore(relPath, eventsRelPath)) continue;
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(fullPath);
        files.set(relPath, { mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {}
    }
  };
  visit(rootDir);
  return files;
}

export function createDevelopmentEventAdapter(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const eventsFile = options.eventsFile || path.join(rootDir, "events.jsonl");
  const branchId = options.branchId || "main";
  const intervalMs = options.intervalMs || 1000;
  const eventsRelPath = toPosixPath(path.relative(rootDir, eventsFile));

  let timer = null;
  let snapshot = new Map();
  let lastEventId = null;

  const appendEvent = (status, relPath) => {
    const event = {
      id: "evt_" + Date.now().toString(36) + "_" + randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      source: "agent",
      type: eventTypeFor(status),
      status,
      label: labelFor(status, relPath),
      parentId: lastEventId,
      branchId,
      files: [relPath],
      metadata: { path: relPath },
    };
    fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n");
    lastEventId = event.id;
    return event;
  };

  const poll = () => {
    const next = scanFiles(rootDir, eventsRelPath);

    for (const [relPath, meta] of next) {
      const prev = snapshot.get(relPath);
      if (!prev) {
        appendEvent("created", relPath);
      } else if (prev.mtimeMs !== meta.mtimeMs || prev.size !== meta.size) {
        appendEvent("modified", relPath);
      }
    }

    for (const relPath of snapshot.keys()) {
      if (!next.has(relPath)) appendEvent("deleted", relPath);
    }

    snapshot = next;
  };

  const start = () => {
    ensureEventsFile(eventsFile);
    lastEventId = readLastEventId(eventsFile);
    snapshot = scanFiles(rootDir, eventsRelPath);
    timer = setInterval(poll, intervalMs);
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const readEventsText = () => {
    ensureEventsFile(eventsFile);
    return fs.readFileSync(eventsFile, "utf8");
  };

  return { start, stop, readEventsText, eventsFile };
}
