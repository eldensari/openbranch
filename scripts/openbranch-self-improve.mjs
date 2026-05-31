import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { parseKaneResults } from "./kane-result-adapter.mjs";
import { codexRunLogEntry, loadCodexPmEnvFiles, runCodexPm, writeCodexRunLog } from "./codex-pm-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const ALLOWLIST = [
  "src/ui/ChatPanel.tsx",
  "src/App.tsx",
  "src/lib/common-events.ts",
  "README.md",
];

function parseArgs(argv) {
  const options = {
    eventsFile: path.join(rootDir, "events.jsonl"),
    tmpDir: path.join(rootDir, ".tmp"),
    envFile: "",
    reset: false,
    codexTimeoutMs: 90_000,
    kiroTimeoutMs: 45_000,
    kaneTimeoutMs: 300_000,
    kaneMaxSteps: 15,
    goal: "OpenBranch improves OpenBranch by making the AI Team Loop status card clearer for judges.",
    feature: "openbranch-self-improvement",
    featureTitle: "OpenBranch Improves OpenBranch",
    branch: "feature/openbranch-self-improvement",
    behavior: "OpenBranch self-improvement verifier. Navigate to http://127.0.0.1:5173. This is not a notification task. Do not click Enable Notification. Verify visible UI evidence: Code Mode control, Story View control, AI Team Loop text, and role legend containing Codex = PM, Kiro = Builder, Kane = Verifier, OpenBranch = Story. You may click Code Mode and Story View controls if needed. Pass only if the final summary explicitly lists those checks.",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for " + arg);
      i += 1;
      return next;
    };
    if (arg === "--events-file") options.eventsFile = path.resolve(readValue());
    else if (arg === "--tmp-dir") options.tmpDir = path.resolve(readValue());
    else if (arg === "--env-file") options.envFile = path.resolve(readValue());
    else if (arg === "--codex-timeout-ms") options.codexTimeoutMs = Number(readValue()) || options.codexTimeoutMs;
    else if (arg === "--kiro-timeout-ms") options.kiroTimeoutMs = Number(readValue()) || options.kiroTimeoutMs;
    else if (arg === "--kane-timeout-ms") options.kaneTimeoutMs = Number(readValue()) || options.kaneTimeoutMs;
    else if (arg === "--kane-max-steps") options.kaneMaxSteps = Number(readValue()) || options.kaneMaxSteps;
    else if (arg === "--reset") options.reset = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return options;
}

function usage() {
  return [
    "Usage: npm run openbranch:self-improve -- --env-file .env.local",
    "",
    "Runs a real OpenBranch self-improvement loop with real evidence only:",
    "- real Codex PM API",
    "- real Kiro CLI invocation",
    "- one deterministic safe local patch in the allowlist",
    "- npm run typecheck",
    "- npm run build",
    "- real kane-cli against http://127.0.0.1:5173",
  ].join("\n");
}

function userHome() {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function rel(file) {
  const relative = path.relative(rootDir, file);
  return normalizePath(relative || file);
}

function quoteArg(value) {
  const text = String(value || "");
  if (!text) return '""';
  return '"' + text.replace(/"/g, '\\"') + '"';
}

function commandLine(command, args = []) {
  return [quoteArg(command), ...args.map(quoteArg)].join(" ");
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log("wrote " + rel(file));
}

function readTextMaybe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJsonMaybe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex");
}

function fileHash(file) {
  return fs.existsSync(file) ? hashText(fs.readFileSync(file, "utf8")) : "";
}

function snapshotAllowlist() {
  const files = {};
  for (const relative of ALLOWLIST) {
    const file = path.join(rootDir, relative);
    files[relative] = {
      exists: fs.existsSync(file),
      hash: fileHash(file),
    };
  }
  return files;
}

function changedAllowlist(before, after) {
  return ALLOWLIST.filter((relative) => before[relative]?.hash !== after[relative]?.hash);
}

function ensureFiles(options) {
  fs.mkdirSync(options.tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(options.eventsFile)), { recursive: true });
  if (options.reset || !fs.existsSync(options.eventsFile)) fs.writeFileSync(options.eventsFile, "");
}

function runCommand(command, args = [], options = {}) {
  const startedAt = new Date();
  const line = Array.isArray(args) ? commandLine(command, args) : String(command);
  const needsQuotedCommandLine =
    Array.isArray(args) &&
    process.platform === "win32" &&
    /\.cmd$/i.test(String(command || ""));
  const result = Array.isArray(args) && !needsQuotedCommandLine ? spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    shell: process.platform === "win32",
    encoding: "utf8",
    timeout: options.timeoutMs || 30_000,
    maxBuffer: 32 * 1024 * 1024,
  }) : spawnSync(line, {
    cwd: options.cwd || rootDir,
    shell: true,
    encoding: "utf8",
    timeout: options.timeoutMs || 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const endedAt = new Date();
  return {
    command: line,
    cwd: options.cwd || rootDir,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    status: typeof result.status === "number" ? result.status : null,
    signal: result.signal || null,
    error: result.error?.message || "",
    timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT"),
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function writeRunLog(file, title, result, extraLines = []) {
  writeFile(file, [
    title,
    "",
    "Command: " + (result?.command || "(not run)"),
    "CWD: " + (result?.cwd || rootDir),
    "Started: " + (result?.startedAt || new Date().toISOString()),
    "Ended: " + (result?.endedAt || new Date().toISOString()),
    "Duration ms: " + (result?.durationMs ?? 0),
    "Exit status: " + (result?.status === null || result?.status === undefined ? "(none)" : result.status),
    "Signal: " + (result?.signal || "(none)"),
    "Error: " + (result?.error || "(none)"),
    ...extraLines,
    "",
    "STDOUT:",
    result?.stdout || "",
    "",
    "STDERR:",
    result?.stderr || "",
  ].join("\n"));
}

function commandExists(command) {
  const candidateExistsOrBlocked = (candidate) => {
    if (!candidate) return false;
    try {
      fs.statSync(candidate);
      return true;
    } catch (error) {
      return error?.code === "EPERM" || error?.code === "EACCES";
    }
  };
  if (process.platform === "win32") {
    const candidates = [];
    if (command === "kiro") {
      candidates.push(path.join(process.env.LOCALAPPDATA || "", "Programs", "Kiro", "bin", "kiro.cmd"));
    }
    if (command === "kane-cli") {
      const npmPrefix = spawnSync("npm", ["config", "get", "prefix"], { encoding: "utf8" });
      const prefix = (npmPrefix.stdout || "").trim();
      if (prefix) candidates.push(path.join(prefix, "kane-cli.cmd"));
      candidates.push(path.join(process.env.APPDATA || "", "npm", "kane-cli.cmd"));
      candidates.push(path.join(userHome(), "AppData", "Roaming", "npm", "kane-cli.cmd"));
    }
    for (const candidate of candidates) {
      if (candidateExistsOrBlocked(candidate)) return candidate;
    }
    for (const candidate of [command, command + ".cmd", command + ".exe"]) {
      const result = spawnSync("where.exe", [candidate], { encoding: "utf8" });
      if (result.status === 0) return (result.stdout || "").trim().split(/\r?\n/)[0];
    }
    return "";
  }
  const result = spawnSync("command", ["-v", command], { encoding: "utf8", shell: true });
  return result.status === 0 ? (result.stdout || "").trim().split(/\r?\n/)[0] : "";
}

function latestKanePowerResult() {
  const sessionsDir = path.join(userHome(), ".testmuai", "kaneai", "sessions");
  if (!fs.existsSync(sessionsDir)) return null;
  const candidates = [];
  for (const session of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = path.join(sessionsDir, session.name);
    const runsDir = path.join(sessionDir, "runs");
    if (!fs.existsSync(runsDir)) continue;
    for (const run of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const runDir = path.join(runsDir, run.name);
      const runTestDir = path.join(runDir, "run-test");
      const actionsFile = path.join(runTestDir, "actions.ndjson");
      const summaryFile = path.join(runTestDir, "run_summary.json");
      const files = [actionsFile, summaryFile].filter((file) => fs.existsSync(file));
      if (!files.length) continue;
      const newest = Math.max(...files.map((file) => fs.statSync(file).mtimeMs));
      candidates.push({
        sessionId: session.name,
        run: run.name,
        sessionDir,
        runDir,
        actionsFile: fs.existsSync(actionsFile) ? actionsFile : "",
        summaryFile: fs.existsSync(summaryFile) ? summaryFile : "",
        resultFile: fs.existsSync(actionsFile) ? actionsFile : summaryFile,
        session: readJsonMaybe(path.join(sessionDir, "session.json")),
        runSummary: readJsonMaybe(summaryFile),
        mtimeMs: newest,
        mtime: new Date(newest).toISOString(),
      });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureDevServer(options) {
  const url = "http://127.0.0.1:5173";
  if (await waitForUrl(url, 2_000)) {
    return { started: false, url, log: "" };
  }
  const out = fs.openSync(path.join(options.tmpDir, "self-improve-devserver.out"), "a");
  const err = fs.openSync(path.join(options.tmpDir, "self-improve-devserver.err"), "a");
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: rootDir,
    shell: true,
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();
  const ready = await waitForUrl(url, 12_000);
  if (!ready) throw new Error("Dev server did not become available at " + url + ".");
  return { started: true, url, log: ".tmp/self-improve-devserver.out" };
}

function buildHandoffFiles(options, plan, capabilitySummary) {
  const goal = [
    "# OpenBranch Self-Improvement Goal",
    "",
    plan.reframedGoal || options.goal,
    "",
    "## Acceptance Criteria",
    "",
    ...(plan.acceptanceCriteria || []).map((item) => "- " + item),
    "",
    "## Capability Summary",
    "",
    capabilitySummary,
  ].join("\n");
  writeFile(path.join(options.tmpDir, "openbranch-goal.md"), goal);
  writeFile(path.join(options.tmpDir, "codex-pm-plan.json"), JSON.stringify(plan, null, 2));
  writeFile(path.join(options.tmpDir, "codex-goal.md"), "/goal " + (plan.reframedGoal || options.goal));
  writeFile(path.join(options.tmpDir, "kiro-build-task.md"), plan.kiroBuildTask);
  writeFile(path.join(options.tmpDir, "kane-verification-task.md"), plan.kaneVerificationTask);
  writeFile(path.join(options.tmpDir, "kane-local-context.md"), [
    "# OpenBranch Local Kane Context",
    "",
    "You are verifying a local OpenBranch app, not the KaneAI Playground.",
    "Always navigate to `http://127.0.0.1:5173` before checking the objective.",
    "Do not stop after navigation; the objective is complete only after the UI checks are verified.",
    "Fail the run if the final URL is not the local OpenBranch app.",
    "Prefer selecting Code Mode and Story View controls over creating a new demo session.",
    "Do not click external links.",
    "For this self-improvement verifier, do not click Run Mock Demo, Manual tools, Settings, Enable Notification, graph menus, or any browser permission control.",
    "You may click the Code Mode and Story View controls if that helps verify both modes.",
    "After navigation and optional mode selection, use visual/text analysis to check the required visible terms.",
    "Your final summary must mention the checked URL plus whether Code Mode / AI Team Loop, the role legend, and Story View were found.",
  ].join("\n"));
  writeFile(path.join(options.tmpDir, "kane-global-context.md"), [
    "# OpenBranch Self-Improvement Kane Context",
    "",
    "Ignore any previous KaneAI Playground, notification, mobile-device, Safari, or guided-flow tasks.",
    "The only task is to verify visible OpenBranch UI terms on `http://127.0.0.1:5173`.",
    "Do not click Run Mock Demo, Manual tools, Settings, Enable Notification, graph menus, or browser permission controls.",
    "Navigate to the local OpenBranch URL. You may click Code Mode and Story View controls if needed.",
    "Pass only if Code Mode, Story View, AI Team Loop, Codex = PM, Kiro = Builder, Kane = Verifier, and OpenBranch = Story are visible.",
  ].join("\n"));
}

function inspectKiro(options) {
  const command = commandExists("kiro");
  const version = command ? runCommand(command, ["--version"], { timeoutMs: 8_000 }) : null;
  const chatHelp = command ? runCommand(command, ["chat", "--help"], { timeoutMs: 8_000 }) : null;
  return {
    command,
    available: Boolean(command),
    versionExitStatus: version?.status ?? null,
    versionOutput: ((version?.stdout || version?.stderr || "").trim()),
    chatHelpExitStatus: chatHelp?.status ?? null,
    modeUsed: "kiro chat --mode ask --add-file .tmp/kiro-build-task.md",
  };
}

function runKiro(options, capabilities) {
  if (!capabilities.available) throw new Error("Kiro CLI was not found; real self-improvement requires real Kiro invocation.");
  const result = process.env.OPENBRANCH_KIRO_COMMAND
    ? runCommand(process.env.OPENBRANCH_KIRO_COMMAND, null, { timeoutMs: options.kiroTimeoutMs })
    : runCommand(capabilities.command, [
        "chat",
        "--mode",
        "ask",
        "--add-file",
        path.join(options.tmpDir, "kiro-build-task.md"),
        "OpenBranch self-improvement builder invocation: read the attached task, confirm the requested UI clarification is actionable, and respond with the exact file you would touch. Do not edit files; OpenBranch will apply a deterministic safe patch and record that honestly.",
      ], { timeoutMs: options.kiroTimeoutMs });
  writeRunLog(path.join(options.tmpDir, "kiro-run.log"), "Kiro self-improvement run log", result, [
    "Mode: " + capabilities.modeUsed,
    "Claim boundary: this proves Kiro consumed the generated build task. File edits are determined by before/after file hashes and git diff, not by assumption.",
  ]);
  return result;
}

function applyDeterministicPatch(options) {
  const relative = "src/ui/ChatPanel.tsx";
  const file = path.join(rootDir, relative);
  const before = fs.readFileSync(file, "utf8");
  const marker = 'data-openbranch-self-improve="role-map"';
  const demoMarker = 'data-openbranch-self-improve="demo-role-map"';
  const target = [
    '      <div className="mt-1 text-xs text-muted-foreground">',
    '        {teamLoopStatus.message || "OpenBranch started the AI Team Loop for this prompt."}',
    "      </div>",
  ].join("\r\n");
  const normalizedTarget = target.replace(/\r\n/g, "\n");
  const insert = [
    '      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-openbranch-self-improve="role-map">',
    '        <span><span className="font-medium text-foreground">Codex</span> = PM</span>',
    '        <span><span className="font-medium text-foreground">Kiro</span> = Builder</span>',
    '        <span><span className="font-medium text-foreground">Kane</span> = Verifier</span>',
    '        <span><span className="font-medium text-foreground">OpenBranch</span> = Story</span>',
    "      </div>",
  ].join("\n");
  const demoTarget = [
    '                    <span className="text-[10px] text-muted-foreground">Kiro, Kane, fix branch, merge</span>',
    "                  </div>",
  ].join("\r\n");
  const normalizedDemoTarget = demoTarget.replace(/\r\n/g, "\n");
  const demoInsert = [
    '                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-openbranch-self-improve="demo-role-map">',
    '                    <span><span className="font-medium text-foreground">Codex</span> = PM</span>',
    '                    <span><span className="font-medium text-foreground">Kiro</span> = Builder</span>',
    '                    <span><span className="font-medium text-foreground">Kane</span> = Verifier</span>',
    '                    <span><span className="font-medium text-foreground">OpenBranch</span> = Story</span>',
    "                  </div>",
  ].join("\n");

  let after = before;
  let applied = false;
  if (!after.includes(marker)) {
    if (after.includes(target)) {
      after = after.replace(target, target + "\r\n" + insert.replace(/\n/g, "\r\n"));
      applied = true;
    } else if (after.includes(normalizedTarget)) {
      after = after.replace(normalizedTarget, normalizedTarget + "\n" + insert);
      applied = true;
    } else {
      throw new Error("Could not find the AI Team Loop status-card insertion point in " + relative + ".");
    }
  }
  if (!after.includes(demoMarker)) {
    if (after.includes(demoTarget)) {
      after = after.replace(demoTarget, demoTarget + "\r\n" + demoInsert.replace(/\n/g, "\r\n"));
      applied = true;
    } else if (after.includes(normalizedDemoTarget)) {
      after = after.replace(normalizedDemoTarget, normalizedDemoTarget + "\n" + demoInsert);
      applied = true;
    } else {
      throw new Error("Could not find the demo-card role-map insertion point in " + relative + ".");
    }
  }
  if (!applied) {
    return {
      applied: false,
      file: relative,
      summary: "Role-map improvements were already present; no deterministic patch was applied.",
      before,
      after: before,
    };
  }
  fs.writeFileSync(file, after);
  const beforeFile = path.join(options.tmpDir, "self-improve-before-ChatPanel.tsx");
  writeFile(beforeFile, before);
  const diff = runCommand("git", ["diff", "--no-index", "--", beforeFile, file], { timeoutMs: 15_000 });
  writeFile(path.join(options.tmpDir, "self-improve-local-change.patch"), diff.stdout || diff.stderr || "");
  return {
    applied: true,
    file: relative,
    summary: "OpenBranch applied a deterministic safe patch that adds explicit role maps to the AI Team Loop status card and first-screen demo card.",
    before,
    after,
  };
}

function runVerificationCommand(options, name, command, args) {
  const result = runCommand(command, args, { timeoutMs: name === "build" ? 180_000 : 120_000 });
  writeRunLog(path.join(options.tmpDir, "self-improve-" + name + ".log"), "Self-improvement " + name + " log", result);
  return result;
}

function inspectKane(options) {
  const command = commandExists("kane-cli");
  const version = command ? runCommand(command, ["--version"], { timeoutMs: 10_000 }) : null;
  return {
    command,
    available: Boolean(command && version?.status === 0),
    versionExitStatus: version?.status ?? null,
    versionOutput: ((version?.stdout || version?.stderr || "").trim()),
    latestBefore: latestKanePowerResult(),
  };
}

function runKane(options, capabilities, beforeLatest) {
  if (!capabilities.available) throw new Error("kane-cli was not available; real self-improvement requires real Kane CLI execution.");
  const timeoutSeconds = String(Math.ceil(options.kaneTimeoutMs / 1000));
  const result = process.env.OPENBRANCH_KANE_COMMAND
    ? runCommand(process.env.OPENBRANCH_KANE_COMMAND, null, { timeoutMs: options.kaneTimeoutMs + 25_000 })
    : runCommand(capabilities.command, [
        "run",
        options.behavior,
        "--agent",
        "--headless",
        "--mode",
        "action",
        "--global-context",
        path.join(options.tmpDir, "kane-global-context.md"),
        "--local-context",
        path.join(options.tmpDir, "kane-local-context.md"),
        "--timeout",
        timeoutSeconds,
        "--max-steps",
        String(options.kaneMaxSteps),
      ], { timeoutMs: options.kaneTimeoutMs + 25_000 });
  const afterLatest = latestKanePowerResult();
  writeRunLog(path.join(options.tmpDir, "kane-run.log"), "Kane self-improvement run log", result, [
    "Mode: " + (process.env.OPENBRANCH_KANE_COMMAND ? "OPENBRANCH_KANE_COMMAND" : "kane-cli run --agent"),
    "Latest session before: " + (beforeLatest?.resultFile || "(none)"),
    "Latest session after: " + (afterLatest?.resultFile || "(none)"),
  ]);
  return { result, beforeLatest, afterLatest, triggered: true };
}

function isNewKaneSession(beforeLatest, afterLatest, runStartedAt) {
  if (!afterLatest?.resultFile) return false;
  if (!beforeLatest?.resultFile) return true;
  if (afterLatest.resultFile !== beforeLatest.resultFile) return true;
  return afterLatest.mtimeMs > Math.max(beforeLatest.mtimeMs || 0, Date.parse(runStartedAt) || 0);
}

function parseJsonLineObjects(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) rows.push(parsed);
    } catch {}
  }
  return rows;
}

function latestKaneRunEnd(stdout) {
  return [...parseJsonLineObjects(stdout)].reverse().find((row) => row.type === "run_end") || null;
}

function loadKaneRecords(kaneRun) {
  const recordsFromStdout = parseKaneResults(kaneRun.result.stdout || "", path.join(rootDir, ".tmp", "kane-run.log"));
  const newSession = isNewKaneSession(kaneRun.beforeLatest, kaneRun.afterLatest, kaneRun.result.startedAt);
  let recordsFromSession = [];
  let sourceFile = "";
  if (newSession && kaneRun.afterLatest?.resultFile && fs.existsSync(kaneRun.afterLatest.resultFile)) {
    sourceFile = kaneRun.afterLatest.resultFile;
    recordsFromSession = parseKaneResults(fs.readFileSync(sourceFile, "utf8"), sourceFile);
  }
  const records = recordsFromSession.length ? recordsFromSession : recordsFromStdout;
  const source = recordsFromSession.length ? "kane_actions_ndjson" : "kane_cli_stdout";
  const runEnd = latestKaneRunEnd(kaneRun.result.stdout || "");
  writeFile(path.join(rootDir, ".tmp", "kane-result.json"), JSON.stringify({
    source,
    sourceFile,
    command: kaneRun.result.command,
    exitStatus: kaneRun.result.status,
    timedOut: kaneRun.result.timedOut,
    runEnd,
    rawStdout: kaneRun.result.stdout || "",
    records,
  }, null, 2));
  return { records, source, sourceFile, newSession, runEnd, rawStdout: kaneRun.result.stdout || "" };
}

function recordOutcome(record, fallbackStatus) {
  const raw = String(record?.event || record?.status || record?.outcome || fallbackStatus || "").toLowerCase();
  if (raw.includes("fail") || raw.includes("error") || raw.includes("reject")) return "failed";
  if (raw.includes("pass") || raw.includes("success") || raw.includes("complete") || raw.includes("ok")) return "passed";
  return fallbackStatus === 0 ? "passed" : "failed";
}

function finalKaneEvidence(kaneData, kaneRun) {
  const finalRecord = [...(kaneData.records || [])].reverse()[0] || {};
  const runEnd = kaneData.runEnd || {};
  const finalUrl = String(runEnd?.final_state?.url || "");
  const evidenceText = [
    runEnd.summary,
    runEnd.one_liner,
    runEnd.reason,
    (() => {
      try {
        return JSON.stringify(runEnd.context || {});
      } catch {
        return "";
      }
    })(),
    (() => {
      try {
        return JSON.stringify(runEnd.final_state || {});
      } catch {
        return "";
      }
    })(),
    kaneData.rawStdout || "",
    ...((kaneData.records || []).map((record) => {
      try {
        return JSON.stringify(record);
      } catch {
        return String(record);
      }
    })),
  ].filter(Boolean).join("\n").toLowerCase();
  const statusFromRecord = recordOutcome(finalRecord, kaneRun.result.status);
  const checks = {
    stayedOnOpenBranch: finalUrl.startsWith("http://127.0.0.1:5173"),
    mentionsTeamLoop: evidenceText.includes("code mode") || evidenceText.includes("ai team loop"),
    mentionsRoleLegend:
      evidenceText.includes("codex") &&
      evidenceText.includes("kiro") &&
      evidenceText.includes("kane") &&
      evidenceText.includes("openbranch"),
    mentionsStoryView: evidenceText.includes("story view"),
  };
  let status = statusFromRecord;
  let proofLine = "";
  if (kaneRun.result.status !== 0) {
    status = "failed";
    proofLine = "Kane CLI exited with status " + kaneRun.result.status + ".";
  } else if (!checks.stayedOnOpenBranch) {
    status = "failed";
    proofLine = "Kane final URL was " + (finalUrl || "(missing)") + ", not http://127.0.0.1:5173.";
  } else if (!checks.mentionsTeamLoop || !checks.mentionsRoleLegend || !checks.mentionsStoryView) {
    status = "failed";
    proofLine = "Kane did not record all required OpenBranch checks in run_end/actions evidence.";
  }
  const evidence = Array.isArray(finalRecord.evidence) ? finalRecord.evidence.map(String).filter(Boolean) : [];
  if (!proofLine) {
    proofLine =
      evidence[0] ||
      runEnd.summary ||
      finalRecord.summary ||
      finalRecord.reason ||
      "Kane final URL stayed on http://127.0.0.1:5173 and recorded the requested OpenBranch checks.";
  }
  return {
    status,
    finalRecord,
    proofLine,
    behavior: finalRecord.behavior || finalRecord.objective || runEnd.summary || "OpenBranch self-improvement verification",
    finalUrl,
    checks,
  };
}

function createEvent(context, overrides) {
  return {
    id: context.sessionId + "_" + overrides.key,
    timestamp: new Date(context.baseMs + (overrides.offsetMs || 0)).toISOString(),
    source: overrides.source,
    type: overrides.type,
    status: overrides.status,
    label: overrides.label,
    parentId: overrides.parentId ?? null,
    branchId: overrides.branchId || "main",
    summary: overrides.summary,
    detail: overrides.detail,
    files: overrides.files,
    mergeParentIds: overrides.mergeParentIds,
    intent: context.feature,
    metadata: {
      controlTowerStep: true,
      teamLoopSessionId: context.sessionId,
      selfImproveReal: true,
      featureKey: context.feature,
      featureTitle: context.featureTitle,
      role: overrides.role,
      executionArtifacts: overrides.executionArtifacts,
      ...(overrides.metadata || {}),
    },
  };
}

function appendEvents(eventsFile, events) {
  fs.appendFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  for (const event of events) console.log("+ " + event.label);
}

function buildEvents(context, evidence) {
  const goal = createEvent(context, {
    key: "user_goal",
    offsetMs: 0,
    source: "user",
    type: "goal",
    status: "goal",
    label: "User asks OpenBranch to improve itself",
    summary: context.goal,
    detail: ["Command: npm run openbranch:self-improve -- --env-file .env.local"],
    role: "user",
  });
  const codex = createEvent(context, {
    key: "codex_pm_defines_improvement",
    offsetMs: 250,
    source: "codex",
    type: "plan",
    status: "planned",
    label: "Codex PM defines the improvement",
    parentId: goal.id,
    summary: evidence.codex.plan.reframedGoal,
    detail: [
      "Real Codex PM API executed: yes",
      "Model: " + evidence.codex.model,
      "Acceptance criteria: " + (evidence.codex.plan.acceptanceCriteria || []).join(" | "),
    ],
    role: "Codex PM",
    executionArtifacts: [".tmp/codex-run.log", ".tmp/codex-pm-plan.json", ".tmp/kiro-build-task.md", ".tmp/kane-verification-task.md"],
    metadata: { codexPmExecuted: true, codexPmStage: "plan_generated", codexPmModel: evidence.codex.model },
  });
  const kiro = createEvent(context, {
    key: "kiro_invoked",
    offsetMs: 500,
    source: "kiro",
    type: "build_attempt",
    status: evidence.kiro.status === 0 ? "building" : "failed",
    label: "Kiro invoked with generated build task",
    parentId: codex.id,
    branchId: context.branch,
    summary: evidence.kiroChangedFiles.length
      ? "Kiro invocation was followed by file changes: " + evidence.kiroChangedFiles.join(", ")
      : "Kiro consumed the generated build task; no file edits were attributed to Kiro.",
    detail: [
      "Mode: " + evidence.kiroMode,
      "Exit status: " + evidence.kiro.status,
      "Concrete moment: Kiro was invoked with --add-file .tmp/kiro-build-task.md.",
    ],
    files: [".tmp/kiro-run.log"],
    role: "Kiro Builder",
    executionArtifacts: [".tmp/kiro-run.log", ".tmp/kiro-build-task.md"],
    metadata: { kiroExecuted: evidence.kiro.status === 0, executionCommand: evidence.kiro.command, executionExitStatus: evidence.kiro.status },
  });
  const change = createEvent(context, {
    key: "local_file_changed",
    offsetMs: 750,
    source: "agent",
    type: "fix_branch",
    status: evidence.patch.applied ? "branching" : "updated",
    label: "OpenBranch applies deterministic safe patch",
    parentId: kiro.id,
    branchId: context.branch,
    summary: evidence.patch.summary,
    detail: [
      "Allowlist file: " + evidence.patch.file,
      "Changed by this run: " + (evidence.changedFiles.join(", ") || "none"),
      "Patch evidence: .tmp/self-improve-local-change.patch",
    ],
    files: evidence.changedFiles,
    role: "OpenBranch",
    executionArtifacts: [".tmp/self-improve-local-change.patch"],
    metadata: { deterministicPatch: true, changedFiles: evidence.changedFiles },
  });
  const typecheck = createEvent(context, {
    key: "typecheck",
    offsetMs: 1000,
    source: "system",
    type: "verify",
    status: evidence.typecheck.status === 0 ? "passed" : "failed",
    label: evidence.typecheck.status === 0 ? "Typecheck passed" : "Typecheck failed",
    parentId: change.id,
    branchId: context.branch,
    summary: "npm run typecheck exit status: " + evidence.typecheck.status,
    detail: ["Log: .tmp/self-improve-typecheck.log"],
    role: "OpenBranch",
    executionArtifacts: [".tmp/self-improve-typecheck.log"],
    metadata: { executionCommand: evidence.typecheck.command, executionExitStatus: evidence.typecheck.status },
  });
  const build = createEvent(context, {
    key: "build",
    offsetMs: 1250,
    source: "system",
    type: "verify",
    status: evidence.build.status === 0 ? "passed" : "failed",
    label: evidence.build.status === 0 ? "Build passed" : "Build failed",
    parentId: typecheck.id,
    branchId: context.branch,
    summary: "npm run build exit status: " + evidence.build.status,
    detail: ["Log: .tmp/self-improve-build.log"],
    role: "OpenBranch",
    executionArtifacts: [".tmp/self-improve-build.log"],
    metadata: { executionCommand: evidence.build.command, executionExitStatus: evidence.build.status },
  });
  const kaneExec = createEvent(context, {
    key: "kane_executes",
    offsetMs: 1500,
    source: "kane",
    type: "verify",
    status: "verifying",
    label: "Kane executes real browser verification",
    parentId: build.id,
    branchId: context.branch,
    summary: "Kane CLI ran against http://127.0.0.1:5173.",
    detail: [
      "Command: " + evidence.kane.command,
      "Actions NDJSON: " + (evidence.kaneActionsPath || "(not found)"),
    ],
    files: [".tmp/kane-run.log", evidence.kaneActionsPath].filter(Boolean),
    role: "Kane Verifier",
    executionArtifacts: [".tmp/kane-run.log", ".tmp/kane-result.json", evidence.kaneActionsPath].filter(Boolean),
    metadata: { kaneExecuted: true, kaneExecutionAttempted: true, executionCommand: evidence.kane.command, executionExitStatus: evidence.kane.status },
  });
  const kaneOutcome = createEvent(context, {
    key: evidence.kaneOutcome.status === "passed" ? "kane_pass" : "kane_fail",
    offsetMs: 1750,
    source: "kane",
    type: evidence.kaneOutcome.status === "passed" ? "pass" : "fail",
    status: evidence.kaneOutcome.status,
    label: evidence.kaneOutcome.status === "passed" ? "Kane passes self-improvement" : "Kane reports self-improvement issue",
    parentId: kaneExec.id,
    branchId: context.branch,
    summary: evidence.kaneOutcome.proofLine,
    detail: [
      "Kane tested: " + evidence.kaneOutcome.behavior,
      "Proof line: " + evidence.kaneOutcome.proofLine,
      "Actions NDJSON: " + (evidence.kaneActionsPath || "(not found)"),
    ],
    files: [".tmp/kane-result.json", evidence.kaneActionsPath].filter(Boolean),
    role: "Kane Verifier",
    executionArtifacts: [".tmp/kane-result.json", evidence.kaneActionsPath].filter(Boolean),
    metadata: {
      kaneExecuted: true,
      kaneVerified: evidence.kaneOutcome.status === "passed",
      kaneBehavior: evidence.kaneOutcome.behavior,
      kaneEvidence: [evidence.kaneOutcome.proofLine],
      kaneSourceFile: evidence.kaneActionsPath,
    },
  });
  const final = evidence.kaneOutcome.status === "passed"
    ? createEvent(context, {
        key: "accepted_lesson",
        offsetMs: 2000,
        source: "merge",
        type: "merge",
        status: "merged",
        label: "Accepted lesson: OpenBranch improves OpenBranch",
        parentId: goal.id,
        branchId: "main",
        mergeParentIds: [kaneOutcome.id],
        summary: evidence.acceptedLesson,
        detail: [
          "Accepted only after real Codex PM, real Kiro invocation, local diff, typecheck, build, and real Kane evidence.",
          "Session summary: .tmp/self-improve-session-summary.md",
        ],
        role: "OpenBranch",
        executionArtifacts: [".tmp/self-improve-real-report.md", ".tmp/self-improve-session-summary.md"],
      })
    : createEvent(context, {
        key: "next_action",
        offsetMs: 2000,
        source: "agent",
        type: "fix_branch",
        status: "branching",
        label: "Next action after Kane feedback",
        parentId: kaneOutcome.id,
        branchId: "fix/openbranch-self-improvement",
        summary: evidence.nextAction,
        detail: ["Kane did not pass; OpenBranch records the next action instead of accepting the lesson."],
        role: "OpenBranch",
        executionArtifacts: [".tmp/self-improve-real-report.md"],
      });
  return [goal, codex, kiro, change, typecheck, build, kaneExec, kaneOutcome, final];
}

function markdownList(items) {
  return items?.length ? items.map((item) => "- " + item).join("\n") : "- none";
}

function buildReports(context, evidence, events) {
  const changed = evidence.changedFiles;
  const verificationResult = evidence.kaneOutcome.status;
  writeFile(path.join(context.tmpDir, "slide-kiro-summary.md"), [
    "# Kiro Summary",
    "",
    "- Mode used: `" + evidence.kiroMode + "`",
    "- Features used: `kiro chat`, `--mode ask`, `--add-file .tmp/kiro-build-task.md`",
    "- Generated/consumed: Kiro consumed `.tmp/kiro-build-task.md` generated by real Codex PM.",
    "- Kiro changed files: " + (evidence.kiroChangedFiles.length ? "yes" : "no"),
    "- Files changed by Kiro: " + (evidence.kiroChangedFiles.join(", ") || "none"),
    "- Files changed by deterministic OpenBranch patch: " + (changed.join(", ") || "none"),
    "- Concrete moment: Kiro was invoked with the generated task file; `.tmp/kiro-run.log` records the command, status, stdout, and stderr.",
  ].join("\n"));
  writeFile(path.join(context.tmpDir, "slide-kane-summary.md"), [
    "# Kane Summary",
    "",
    "- Verified: app loads; Code Mode / AI Team Loop visible; role legend visible; Story View usable.",
    "- Wiring: `kane-cli run ... --agent --headless` against `http://127.0.0.1:5173`.",
    "- Exact command: `" + evidence.kane.command.replace(/`/g, "'") + "`",
    "- actions.ndjson path: `" + (evidence.kaneActionsPath || "missing") + "`",
    "- Result: " + verificationResult,
    "- Proof line: " + evidence.kaneOutcome.proofLine,
  ].join("\n"));
  writeFile(path.join(context.tmpDir, "self-improve-real-report.md"), [
    "# OpenBranch Real Self-Improvement Report",
    "",
    "## Session",
    "",
    "- Session ID: `" + context.sessionId + "`",
    "- Timestamp: `" + context.timestamp + "`",
    "- Goal: " + context.goal,
    "",
    "## Real Evidence",
    "",
    "- Codex PM API executed: yes (`.tmp/codex-run.log`)",
    "- Kiro invoked: " + (evidence.kiro.status === 0 ? "yes" : "no") + " (`.tmp/kiro-run.log`)",
    "- Deterministic local patch applied: " + (evidence.patch.applied ? "yes" : "no"),
    "- Typecheck exit status: " + evidence.typecheck.status,
    "- Build exit status: " + evidence.build.status,
    "- Kane CLI exit status: " + evidence.kane.status,
    "- Kane actions.ndjson: `" + (evidence.kaneActionsPath || "missing") + "`",
    "",
    "## Files Changed By This Run",
    "",
    markdownList(changed),
    "",
    "## Verification Result",
    "",
    verificationResult,
    "",
    "## Accepted Lesson / Next Action",
    "",
    verificationResult === "passed" ? evidence.acceptedLesson : evidence.nextAction,
    "",
    "## Story Events",
    "",
    events.map((event) => "- " + event.label).join("\n"),
  ].join("\n"));
  writeFile(path.join(context.tmpDir, "self-improve-session-summary.md"), [
    "# Self-Improvement Session Summary",
    "",
    "- Session ID: `" + context.sessionId + "`",
    "- Timestamp: `" + context.timestamp + "`",
    "- Goal: " + context.goal,
    "- Files changed: " + (changed.join(", ") || "none"),
    "- Verification result: " + verificationResult,
    "- Accepted lesson: " + (verificationResult === "passed" ? evidence.acceptedLesson : "Not accepted; next action recorded."),
  ].join("\n"));
}

function copyEvidenceFile(sourceFile, destFile) {
  if (!sourceFile || !fs.existsSync(sourceFile)) return "";
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(sourceFile, destFile);
  return rel(destFile);
}

function persistSessionEvidence(context, evidence) {
  const sessionDir = path.join(context.tmpDir, "self-improve-sessions", context.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const fixedFiles = [
    ["codexRunLog", path.join(context.tmpDir, "codex-run.log"), "codex-run.log"],
    ["codexPmPlan", path.join(context.tmpDir, "codex-pm-plan.json"), "codex-pm-plan.json"],
    ["codexPmFeedback", path.join(context.tmpDir, "codex-pm-feedback.json"), "codex-pm-feedback.json"],
    ["kiroRunLog", path.join(context.tmpDir, "kiro-run.log"), "kiro-run.log"],
    ["kiroBuildTask", path.join(context.tmpDir, "kiro-build-task.md"), "kiro-build-task.md"],
    ["kaneRunLog", path.join(context.tmpDir, "kane-run.log"), "kane-run.log"],
    ["kaneResult", path.join(context.tmpDir, "kane-result.json"), "kane-result.json"],
    ["kaneVerificationTask", path.join(context.tmpDir, "kane-verification-task.md"), "kane-verification-task.md"],
    ["kaneGlobalContext", path.join(context.tmpDir, "kane-global-context.md"), "kane-global-context.md"],
    ["kaneLocalContext", path.join(context.tmpDir, "kane-local-context.md"), "kane-local-context.md"],
    ["localChangePatch", path.join(context.tmpDir, "self-improve-local-change.patch"), "self-improve-local-change.patch"],
    ["typecheckLog", path.join(context.tmpDir, "self-improve-typecheck.log"), "self-improve-typecheck.log"],
    ["buildLog", path.join(context.tmpDir, "self-improve-build.log"), "self-improve-build.log"],
    ["realReport", path.join(context.tmpDir, "self-improve-real-report.md"), "self-improve-real-report.md"],
    ["kiroSlideSummary", path.join(context.tmpDir, "slide-kiro-summary.md"), "slide-kiro-summary.md"],
    ["kaneSlideSummary", path.join(context.tmpDir, "slide-kane-summary.md"), "slide-kane-summary.md"],
    ["sessionSummary", path.join(context.tmpDir, "self-improve-session-summary.md"), "self-improve-session-summary.md"],
  ];
  const artifacts = {};
  for (const [key, sourceFile, filename] of fixedFiles) {
    const copied = copyEvidenceFile(sourceFile, path.join(sessionDir, filename));
    if (copied) artifacts[key] = copied;
  }
  const copiedActions = copyEvidenceFile(evidence.kaneActionsPath, path.join(sessionDir, "kane-actions.ndjson"));
  if (copiedActions) artifacts.kaneActionsNdjson = copiedActions;
  return {
    sessionDir: rel(sessionDir),
    artifacts,
  };
}

function readSessionRegistry(file) {
  const parsed = readJsonMaybe(file);
  if (!Array.isArray(parsed?.sessions)) return [];
  return parsed.sessions.filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string");
}

function writeSessionRegistry(context, sessionArtifact) {
  const sessionsRoot = path.join(context.tmpDir, "self-improve-sessions");
  fs.mkdirSync(sessionsRoot, { recursive: true });
  const sessionFile = path.join(sessionsRoot, context.sessionId + ".json");
  const registryFile = path.join(context.tmpDir, "openbranch-self-improve-sessions.json");
  writeFile(sessionFile, JSON.stringify(sessionArtifact, null, 2));
  writeFile(path.join(context.tmpDir, "openbranch-self-improve-session.json"), JSON.stringify(sessionArtifact, null, 2));
  const registry = readSessionRegistry(registryFile).filter((entry) => entry.id !== sessionArtifact.id);
  registry.unshift({
    id: sessionArtifact.id,
    conversationId: sessionArtifact.conversationId,
    clusterId: sessionArtifact.clusterId,
    title: sessionArtifact.title,
    timestamp: sessionArtifact.timestamp,
    sessionFile: rel(sessionFile),
    verificationResult: sessionArtifact.verificationResult,
    changedFiles: sessionArtifact.changedFiles,
  });
  writeFile(registryFile, JSON.stringify({ sessions: registry }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  ensureFiles(options);
  const sessionId = "self_improve_" + Date.now().toString(36) + "_" + randomUUID().slice(0, 8);
  const timestamp = new Date().toISOString();
  const context = { ...options, sessionId, timestamp, baseMs: Date.now(), tmpDir: options.tmpDir };

  const loadedEnv = loadCodexPmEnvFiles({ rootDir, envFile: options.envFile });
  const devServer = await ensureDevServer(options);
  const kiroCapabilities = inspectKiro(options);
  const kaneCapabilities = inspectKane(options);
  const capabilitySummary = [
    "- Dev server: " + devServer.url + (devServer.started ? " (started by this run)" : " (already running)"),
    "- Kiro CLI available: " + kiroCapabilities.available,
    "- Kane CLI available: " + kaneCapabilities.available,
    "- Codex PM env files loaded: " + (loadedEnv.length ? loadedEnv.map((entry) => rel(entry.file)).join(", ") : "none"),
  ].join("\n");

  const codexInitial = await runCodexPm(options, {
    mode: "self_improvement_initial_plan",
    timeoutMs: options.codexTimeoutMs,
    capabilitySummary,
  });
  codexInitial.envFilesLoaded = loadedEnv.map((entry) => ({ file: rel(entry.file), keys: entry.keys }));
  if (!codexInitial.apiExecuted) {
    writeCodexRunLog(path.join(options.tmpDir, "codex-run.log"), [codexRunLogEntry(codexInitial, "Codex PM self-improvement initial plan")]);
    throw new Error("Codex PM API did not execute; refusing to create a real self-improvement story from fallback data.");
  }
  const codexLogEntries = [codexRunLogEntry(codexInitial, "Codex PM self-improvement initial plan")];
  writeCodexRunLog(path.join(options.tmpDir, "codex-run.log"), codexLogEntries);
  buildHandoffFiles(options, codexInitial.plan, capabilitySummary);

  const beforeKiro = snapshotAllowlist();
  const kiroRun = runKiro(options, kiroCapabilities);
  const afterKiro = snapshotAllowlist();
  const kiroChangedFiles = changedAllowlist(beforeKiro, afterKiro);

  const beforePatch = snapshotAllowlist();
  const patch = applyDeterministicPatch(options);
  const afterPatch = snapshotAllowlist();
  const changedFiles = changedAllowlist(beforePatch, afterPatch);

  const typecheck = runVerificationCommand(options, "typecheck", "npm", ["run", "typecheck"]);
  const build = runVerificationCommand(options, "build", "npm", ["run", "build"]);

  const beforeKane = latestKanePowerResult();
  const kaneRun = runKane(options, kaneCapabilities, beforeKane);
  const kaneData = loadKaneRecords(kaneRun);
  const kaneOutcome = finalKaneEvidence(kaneData, kaneRun);

  let codexAfterKane = null;
  if (kaneOutcome.status === "passed") {
    codexAfterKane = await runCodexPm(options, {
      mode: "self_improvement_accept_after_kane",
      timeoutMs: options.codexTimeoutMs,
      previousPlan: codexInitial.plan,
      kaneFeedback: JSON.stringify({
        status: kaneOutcome.status,
        proofLine: kaneOutcome.proofLine,
        actionsNdjson: kaneData.sourceFile,
        typecheckStatus: typecheck.status,
        buildStatus: build.status,
        changedFiles,
      }, null, 2),
    });
    codexAfterKane.envFilesLoaded = codexInitial.envFilesLoaded;
    codexLogEntries.push(codexRunLogEntry(codexAfterKane, "Codex PM accepted lesson after Kane"));
    writeCodexRunLog(path.join(options.tmpDir, "codex-run.log"), codexLogEntries);
    writeFile(path.join(options.tmpDir, "codex-pm-feedback.json"), JSON.stringify(codexAfterKane.plan, null, 2));
  }

  const evidence = {
    codex: codexInitial,
    kiro: kiroRun,
    kiroMode: kiroCapabilities.modeUsed,
    kiroChangedFiles,
    patch,
    changedFiles,
    typecheck,
    build,
    kane: kaneRun.result,
    kaneActionsPath: kaneData.sourceFile ? normalizePath(kaneData.sourceFile) : "",
    kaneOutcome,
    acceptedLesson: codexAfterKane?.apiExecuted ? codexAfterKane.plan.acceptedLesson : codexInitial.plan.acceptedLesson,
    nextAction: codexAfterKane?.plan?.nextActionAfterKaneFeedback || codexInitial.plan.nextActionAfterKaneFeedback,
  };

  const events = buildEvents(context, evidence);
  appendEvents(options.eventsFile, events);
  buildReports(context, evidence, events);
  const persistedEvidence = persistSessionEvidence(context, evidence);

  const sessionArtifact = {
    id: sessionId,
    conversationId: "conv:self_improve:" + sessionId,
    clusterId: "cluster:self_improve:" + sessionId,
    title: "OpenBranch Improves OpenBranch",
    timestamp,
    goal: options.goal,
    events,
    graph: events.map((event) => ({
      id: event.id,
      parentId: event.parentId,
      branchId: event.branchId,
      mergeParentIds: event.mergeParentIds || [],
    })),
    codexPlan: codexInitial.plan,
    kiro: {
      modeUsed: kiroCapabilities.modeUsed,
      command: kiroRun.command,
      status: kiroRun.status,
      changedFiles: kiroChangedFiles,
    },
    kane: {
      command: kaneRun.result.command,
      status: kaneRun.result.status,
      actionsNdjson: evidence.kaneActionsPath,
      outcome: kaneOutcome.status,
      proofLine: kaneOutcome.proofLine,
      finalUrl: kaneOutcome.finalUrl,
      checks: kaneOutcome.checks,
    },
    changedFiles,
    verificationResult: kaneOutcome.status,
    acceptedLesson: kaneOutcome.status === "passed" ? evidence.acceptedLesson : "",
    evidence: {
      latestArtifacts: {
        codexRunLog: ".tmp/codex-run.log",
        kiroRunLog: ".tmp/kiro-run.log",
        localChangePatch: ".tmp/self-improve-local-change.patch",
        typecheckLog: ".tmp/self-improve-typecheck.log",
        buildLog: ".tmp/self-improve-build.log",
        kaneRunLog: ".tmp/kane-run.log",
        kaneResult: ".tmp/kane-result.json",
        actionsNdjson: evidence.kaneActionsPath,
        eventsJsonl: rel(options.eventsFile),
      },
      persistedArtifacts: persistedEvidence.artifacts,
      sessionDirectory: persistedEvidence.sessionDir,
    },
  };
  writeSessionRegistry(context, sessionArtifact);

  if (typecheck.status !== 0) throw new Error("Self-improvement typecheck failed; see .tmp/self-improve-typecheck.log.");
  if (build.status !== 0) throw new Error("Self-improvement build failed; see .tmp/self-improve-build.log.");
  if (!kaneData.newSession || !evidence.kaneActionsPath) {
    throw new Error("Kane CLI ran, but this run did not produce a new real actions.ndjson file.");
  }
  if (kaneOutcome.status !== "passed") {
    throw new Error("Kane did not pass; next action was recorded in the Story View events.");
  }

  console.log("");
  console.log("OpenBranch self-improvement complete.");
  console.log("Session: " + sessionId);
  console.log("Changed files: " + (changedFiles.join(", ") || "none"));
  console.log("Kane actions.ndjson: " + evidence.kaneActionsPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
