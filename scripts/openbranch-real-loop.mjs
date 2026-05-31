import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseKaneResults, kaneResultsToOpenBranchEvents } from "./kane-result-adapter.mjs";
import { codexRunLogEntry, loadCodexPmEnvFiles, runCodexPm, writeCodexRunLog } from "./codex-pm-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    eventsFile: path.join(rootDir, "events.jsonl"),
    tmpDir: path.join(rootDir, ".tmp"),
    reset: false,
    goal: "Prove OpenBranch can record an honest Codex -> Kiro -> Kane -> OpenBranch AI development loop.",
    feature: "real-ai-development-loop",
    featureTitle: "Real AI Development Loop",
    branch: "feature/real-ai-development-loop",
    behavior: "Go to http://127.0.0.1:5173 and assert the OpenBranch app loads.",
    kiroTimeoutMs: 30_000,
    kaneTimeoutMs: 180_000,
    kaneMaxSteps: 8,
    codexTimeoutMs: 60_000,
    skipKiro: false,
    skipKane: false,
    envFile: "",
    requireCodexApi: false,
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
    else if (arg === "--goal") options.goal = readValue();
    else if (arg === "--feature") options.feature = readValue();
    else if (arg === "--feature-title") options.featureTitle = readValue();
    else if (arg === "--branch") options.branch = readValue();
    else if (arg === "--behavior") options.behavior = readValue();
    else if (arg === "--kiro-timeout-ms") options.kiroTimeoutMs = Number(readValue()) || options.kiroTimeoutMs;
    else if (arg === "--kane-timeout-ms") options.kaneTimeoutMs = Number(readValue()) || options.kaneTimeoutMs;
    else if (arg === "--kane-max-steps") options.kaneMaxSteps = Number(readValue()) || options.kaneMaxSteps;
    else if (arg === "--codex-timeout-ms") options.codexTimeoutMs = Number(readValue()) || options.codexTimeoutMs;
    else if (arg === "--skip-kiro") options.skipKiro = true;
    else if (arg === "--skip-kane") options.skipKane = true;
    else if (arg === "--require-codex-api") options.requireCodexApi = true;
    else if (arg === "--reset") options.reset = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return options;
}

function usage() {
  return [
    "Usage: npm run openbranch:real-loop -- [--reset]",
    "",
    "Creates an honest OpenBranch real-loop trail:",
    "- invokes Codex PM through the OpenAI Responses API when OPENAI_API_KEY is set",
    "- loads .env.local, .env, OPENBRANCH_ENV_FILE, or --env-file when present",
    "- writes .tmp/codex-run.log",
    "- pass --require-codex-api to fail fast unless the PM API actually runs",
    "- writes .tmp/kiro-capabilities.json and .tmp/kane-capabilities.json",
    "- writes .tmp/kiro-run.log and .tmp/kane-run.log",
    "- invokes Kiro CLI when available",
    "- invokes Kane CLI when available",
    "- ingests the actual execution result or records the exact gap",
    "- appends Story View nodes to events.jsonl",
  ].join("\n");
}

function userHome() {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function normalizePath(file) {
  return file.replace(/\\/g, "/");
}

function rel(file) {
  const relative = path.relative(rootDir, file);
  return normalizePath(relative || file);
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

function ensureFiles(options) {
  fs.mkdirSync(options.tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(options.eventsFile)), { recursive: true });
  if (options.reset || !fs.existsSync(options.eventsFile)) fs.writeFileSync(options.eventsFile, "");
}

function appendEvent(eventsFile, event) {
  fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n");
  console.log("+ " + event.label);
  return event;
}

function appendEvents(eventsFile, events) {
  for (const event of events) appendEvent(eventsFile, event);
}

function id(sessionId, name) {
  return sessionId + "_" + name + "_" + randomUUID().slice(0, 8);
}

function shiftedIso(baseTs, deltaMs) {
  return new Date(baseTs + deltaMs).toISOString();
}

function quoteArg(value) {
  const text = String(value);
  if (!text) return '""';
  return '"' + text.replace(/"/g, '\\"') + '"';
}

function commandLine(command, args = []) {
  return [quoteArg(command), ...args.map(quoteArg)].join(" ");
}

function runCommand(command, args = [], options = {}) {
  const startedAt = new Date();
  const line = Array.isArray(args) ? commandLine(command, args) : String(command);
  const result = spawnSync(line, {
    cwd: options.cwd || rootDir,
    shell: true,
    encoding: "utf8",
    timeout: options.timeoutMs || 15_000,
    maxBuffer: 16 * 1024 * 1024,
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
  const lines = [
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
  ];
  writeFile(file, lines.join("\n"));
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

function buildHandoffFiles(options, capabilitySummary, codexPlan, codexApiExecuted) {
  const plan = codexPlan || {
    reframedGoal: options.goal,
    developmentPlan: ["Create the goal, invoke Kiro, invoke Kane, then record the verified result."],
    acceptanceCriteria: [options.behavior],
    kiroBuildTask: "",
    kaneVerificationTask: "",
    nextActionAfterKaneFeedback: "Use Kane feedback to accept the lesson or create a fix branch.",
    acceptedLesson: "OpenBranch records the verified AI development loop.",
  };
  const goal = [
    "# OpenBranch Real AI Development Goal",
    "",
    plan.reframedGoal || options.goal,
    "",
    "## Roles",
    "",
    "- Codex = PM / goal keeper",
    "- Kiro = Builder",
    "- Kane = Verifier",
    "- OpenBranch = control tower + event memory",
    "",
    "## Honest Execution Contract",
    "",
    "- Claim Kiro execution only when a Kiro command was invoked.",
    "- Claim Kane verification only when Kane CLI or a real Kane Power run produced evidence.",
    "- Put capability findings and run logs in Technical Details.",
    "",
    "## Behavior To Verify",
    "",
    options.behavior,
    "",
    "## Codex PM Plan",
    "",
    ...(plan.developmentPlan || []).map((step, index) => String(index + 1) + ". " + step),
    "",
    "## Acceptance Criteria",
    "",
    ...(plan.acceptanceCriteria || []).map((criterion) => "- " + criterion),
    "",
    "## Current Capability Summary",
    "",
    capabilitySummary,
  ].join("\n");
  const codex = [
    "/goal " + (plan.reframedGoal || options.goal),
    "",
    codexApiExecuted
      ? "This handoff was generated by the real Codex PM API. Do not claim downstream execution unless logs prove it."
      : "Codex PM fallback mode: this handoff was generated locally because the API did not run. Do not claim Codex PM API execution.",
    "",
    "## Development Plan",
    "",
    ...(plan.developmentPlan || []).map((step, index) => String(index + 1) + ". " + step),
    "",
    "## Acceptance Criteria",
    "",
    ...(plan.acceptanceCriteria || []).map((criterion) => "- " + criterion),
    "",
    "## Next Action After Kane Feedback",
    "",
    plan.nextActionAfterKaneFeedback || "Use Kane feedback to decide the next branch action.",
    "",
    "- Kiro capabilities: `.tmp/kiro-capabilities.json`",
    "- Kane capabilities: `.tmp/kane-capabilities.json`",
    "- Codex PM run log: `.tmp/codex-run.log`",
    "- Kiro run log: `.tmp/kiro-run.log`",
    "- Kane run log: `.tmp/kane-run.log`",
    "- Kane result: `.tmp/kane-result.json`",
  ].join("\n");
  const fallbackKiro = [
    "# Kiro Builder Task",
    "",
    plan.reframedGoal || options.goal,
    "",
    "## Branch",
    "",
    "`" + options.branch + "`",
    "",
    "## Builder Scope",
    "",
    "Read the goal and decide whether the task is actionable. For this MVP runner, do not claim code was implemented unless the Kiro run log or file diff proves it.",
    "",
    "## Behavior Kane Will Verify",
    "",
    options.behavior,
  ].join("\n");
  const fallbackKane = [
    "# Kane Verification Task",
    "",
    "Use Kane CLI when available:",
    "",
    "`kane-cli run \"" + options.behavior.replace(/"/g, "'") + "\" --agent --headless --timeout 120`",
    "",
    "## Behavior",
    "",
    options.behavior,
    "",
    "OpenBranch will ingest stdout or session artifacts and write `.tmp/kane-result.json`.",
  ].join("\n");
  const kiro = plan.kiroBuildTask || fallbackKiro;
  const kane = plan.kaneVerificationTask || fallbackKane;

  writeFile(path.join(options.tmpDir, "openbranch-goal.md"), goal);
  writeFile(path.join(options.tmpDir, "codex-goal.md"), codex);
  writeFile(path.join(options.tmpDir, "codex-pm-plan.json"), JSON.stringify(plan, null, 2));
  writeFile(path.join(options.tmpDir, "kiro-build-task.md"), kiro);
  writeFile(path.join(options.tmpDir, "kane-verification-task.md"), kane);
}

function inspectKiro(options) {
  const command = commandExists("kiro");
  const version = command ? runCommand(command, ["--version"], { timeoutMs: 8_000 }) : null;
  const help = command ? runCommand(command, ["--help"], { timeoutMs: 8_000 }) : null;
  const chatHelp = command ? runCommand(command, ["chat", "--help"], { timeoutMs: 8_000 }) : null;
  const chatHelpText = (chatHelp?.stdout || "") + "\n" + (chatHelp?.stderr || "");
  const appRoaming = path.join(userHome(), "AppData", "Roaming", "Kiro");
  const appLocal = path.join(userHome(), "AppData", "Local", "Kiro");

  return {
    generatedAt: new Date().toISOString(),
    cli: {
      command: command || "",
      available: Boolean(command),
      versionExitStatus: version?.status ?? null,
      versionOutput: ((version?.stdout || version?.stderr || "").trim()),
      helpExitStatus: help?.status ?? null,
      chatHelpExitStatus: chatHelp?.status ?? null,
    },
    findings: {
      canKiroBeInvokedFromCli: Boolean(command && version?.status === 0 && chatHelp?.status === 0),
      canKiroConsumeTaskFileAutomatically: Boolean(command && /--add-file/.test(chatHelpText) && /chat/.test(chatHelpText)),
      canKiroRunSpecOrPowerProgrammatically: false,
      canOpenBranchTriggerKiroFromThisRepo: Boolean(command),
      runClaimBoundary: "The CLI can be invoked with `kiro chat --mode ask --add-file .tmp/kiro-build-task.md ...`; a zero exit code proves invocation, not implementation or file edits.",
    },
    discoveredCommands: {
      safeProbe: command
        ? commandLine(command, [
            "chat",
            "--mode",
            "ask",
            "--add-file",
            path.join(options.tmpDir, "kiro-build-task.md"),
            "OpenBranch capability probe: read the attached task and reply with READY plus one sentence. Do not edit files.",
          ])
        : "",
      envOverride: "OPENBRANCH_KIRO_COMMAND",
    },
    logsAndOutputs: {
      openBranchRunLog: path.join(options.tmpDir, "kiro-run.log"),
      kiroHome: path.join(userHome(), ".kiro"),
      kiroTasksDir: path.join(userHome(), ".kiro", "tasks"),
      kiroPowersDir: path.join(userHome(), ".kiro", "powers"),
      appRoamingExists: fs.existsSync(appRoaming),
      appRoamingPath: appRoaming,
      appLocalExists: fs.existsSync(appLocal),
      appLocalPath: appLocal,
    },
  };
}

function runKiro(options, capabilities) {
  if (options.skipKiro || !capabilities.cli.available) {
    const skipped = {
      command: "",
      cwd: rootDir,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      status: null,
      signal: null,
      error: options.skipKiro ? "Skipped by --skip-kiro." : "Kiro CLI was not found.",
      timedOut: false,
      stdout: "",
      stderr: "",
    };
    writeRunLog(path.join(options.tmpDir, "kiro-run.log"), "Kiro run log", skipped);
    return skipped;
  }

  if (process.env.OPENBRANCH_KIRO_COMMAND) {
    const result = runCommand(process.env.OPENBRANCH_KIRO_COMMAND, null, { timeoutMs: options.kiroTimeoutMs });
    writeRunLog(path.join(options.tmpDir, "kiro-run.log"), "Kiro run log", result, ["Mode: OPENBRANCH_KIRO_COMMAND"]);
    return result;
  }

  const result = runCommand(capabilities.cli.command, [
    "chat",
    "--mode",
    "ask",
    "--add-file",
    path.join(options.tmpDir, "kiro-build-task.md"),
    "OpenBranch real-loop builder probe: read the attached task and answer whether it is actionable. Do not edit files.",
  ], { timeoutMs: options.kiroTimeoutMs });
  writeRunLog(path.join(options.tmpDir, "kiro-run.log"), "Kiro run log", result, [
    "Mode: safe Kiro CLI chat invocation",
    "Claim boundary: this log proves Kiro CLI invocation only; it does not prove Kiro implemented code.",
  ]);
  return result;
}

function inspectKane(options) {
  const command = commandExists("kane-cli");
  const version = command ? runCommand(command, ["--version"], { timeoutMs: 10_000 }) : null;
  const latest = latestKanePowerResult();
  const powerFile = path.join(userHome(), ".kiro", "powers", "installed", "kiro-powers", "POWER.md");
  const hookFile = path.join(userHome(), ".kiro", "powers", "repos", "kiro-powers", "integrations", "kiro-powers", "hooks", "kane-verify.kiro.hook");
  const tuiConfigFile = path.join(userHome(), ".testmuai", "kaneai", "tui-config.json");
  const tuiConfig = readJsonMaybe(tuiConfigFile);

  return {
    generatedAt: new Date().toISOString(),
    cli: {
      command: command || "",
      available: Boolean(command && version?.status === 0),
      installedButBlocked: Boolean(command && version?.status !== 0),
      versionExitStatus: version?.status ?? null,
      versionOutput: ((version?.stdout || version?.stderr || "").trim()),
      versionError: version?.error || "",
    },
    power: {
      installed: fs.existsSync(powerFile),
      powerFile,
      hookFile,
      hookInstalledInPowerRepo: fs.existsSync(hookFile),
      invocationFromPowerDocs: 'kane-cli run "<objective>" --agent --headless --timeout 120',
      configFileRead: Boolean(tuiConfig),
      projectName: tuiConfig?.project_name || "",
      folderName: tuiConfig?.folder_name || "",
      model: tuiConfig?.model || "",
    },
    latestSession: latest
      ? {
          sessionId: latest.sessionId,
          run: latest.run,
          status: latest.session?.status || latest.runSummary?.final_status || "",
          objective: latest.runSummary?.objective || latest.session?.runs?.[0]?.objective || "",
          resultFile: latest.resultFile,
          actionsFile: latest.actionsFile,
          summaryFile: latest.summaryFile,
          runDir: latest.runDir,
          mtime: latest.mtime,
          comesFromRealKaneRun: true,
          createdByThisOpenBranchRun: false,
        }
      : null,
    findings: {
      howKanePowerIsCurrentlyInvoked: "The installed Kiro Power tells Kiro to run `kane-cli run \"<objective>\" --agent`; the sample Kiro hook also uses `kane-cli run` or `kane-cli testmd run` after frontend edits.",
      whichCommandsAreActuallyExecutedByThisRunner: process.env.OPENBRANCH_KANE_COMMAND
        ? "OPENBRANCH_KANE_COMMAND"
        : command
          ? commandLine(command, ["run", options.behavior, "--agent", "--headless", "--timeout", String(Math.ceil(options.kaneTimeoutMs / 1000)), "--max-steps", String(options.kaneMaxSteps)])
          : "",
      whetherKaneCliIsAvailable: Boolean(command && version?.status === 0),
      whetherActionsNdjsonComesFromRealKaneRun: Boolean(latest),
      whetherOpenBranchCanTriggerNewKaneRun: Boolean(command && version?.status === 0),
      runClaimBoundary: "Kane is marked executed only when this runner starts a Kane CLI process. Existing actions.ndjson is marked as an ingested real Kane result, not a run triggered by OpenBranch.",
    },
    logsAndOutputs: {
      openBranchRunLog: path.join(options.tmpDir, "kane-run.log"),
      openBranchResult: path.join(options.tmpDir, "kane-result.json"),
      sessionsDir: path.join(userHome(), ".testmuai", "kaneai", "sessions"),
    },
  };
}

function runKane(options, capabilities, beforeLatest) {
  if (options.skipKane || !capabilities.cli.available) {
    const skipped = {
      command: "",
      cwd: rootDir,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      status: null,
      signal: null,
      error: options.skipKane ? "Skipped by --skip-kane." : "Kane CLI was not available or runnable.",
      timedOut: false,
      stdout: "",
      stderr: "",
    };
    writeRunLog(path.join(options.tmpDir, "kane-run.log"), "Kane run log", skipped);
    return { result: skipped, afterLatest: latestKanePowerResult(), triggered: false, beforeLatest };
  }

  const timeoutSeconds = String(Math.ceil(options.kaneTimeoutMs / 1000));
  const result = process.env.OPENBRANCH_KANE_COMMAND
    ? runCommand(process.env.OPENBRANCH_KANE_COMMAND, null, { timeoutMs: options.kaneTimeoutMs + 20_000 })
    : runCommand(capabilities.cli.command, [
        "run",
        options.behavior,
        "--agent",
        "--headless",
        "--timeout",
        timeoutSeconds,
        "--max-steps",
        String(options.kaneMaxSteps),
      ], { timeoutMs: options.kaneTimeoutMs + 20_000 });

  const afterLatest = latestKanePowerResult();
  writeRunLog(path.join(options.tmpDir, "kane-run.log"), "Kane run log", result, [
    "Mode: " + (process.env.OPENBRANCH_KANE_COMMAND ? "OPENBRANCH_KANE_COMMAND" : "kane-cli run --agent"),
    "Latest session before: " + (beforeLatest?.resultFile || "(none)"),
    "Latest session after: " + (afterLatest?.resultFile || "(none)"),
  ]);
  return { result, afterLatest, triggered: true, beforeLatest };
}

function parseJsonLines(text) {
  const rows = [];
  for (const line of (text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row);
    } catch {}
  }
  return rows;
}

function normalizedKaneCliTerminalRecords(stdout, options) {
  const rows = parseJsonLines(stdout);
  const terminal = [...rows].reverse().find((row) => row.type === "run_end");
  if (!terminal) return [];
  const passed = terminal.status === "passed";
  const runDir = typeof terminal.run_dir === "string" ? terminal.run_dir : "";
  const actionsFile = runDir ? path.join(runDir, "run-test", "actions.ndjson") : "";
  const evidence = [
    typeof terminal.summary === "string" ? terminal.summary : "",
    terminal.final_state ? "Final state: " + JSON.stringify(terminal.final_state) : "",
    runDir ? "Run dir: " + runDir : "",
  ].filter(Boolean);
  return [{
    event: passed ? "verification_passed" : "verification_failed",
    status: passed ? "passed" : "failed",
    behavior: options.behavior,
    summary: terminal.one_liner || terminal.summary || terminal.reason || "Kane CLI completed.",
    failure: passed ? "" : (terminal.reason || terminal.summary || "Kane CLI reported a failing run."),
    evidence,
    files: actionsFile ? [actionsFile] : [],
    source_file: actionsFile || "",
    run_dir: runDir,
    raw_result: terminal,
  }];
}

function writeKaneResultSnapshot(options, kaneRun) {
  const resultFile = path.join(options.tmpDir, "kane-result.json");
  const text = (kaneRun.result.stdout || "").trim();
  if (text) {
    const normalized = normalizedKaneCliTerminalRecords(kaneRun.result.stdout, options);
    const parsed = normalized.length ? normalized : parseKaneResults(kaneRun.result.stdout, resultFile);
    writeFile(resultFile, JSON.stringify({
      source: "kane_cli_stdout",
      command: kaneRun.result.command,
      exitStatus: kaneRun.result.status,
      stdout: kaneRun.result.stdout,
      stderr: kaneRun.result.stderr,
      parsed,
    }, null, 2));
    return { source: "kane_cli_stdout", file: resultFile, text: JSON.stringify(parsed, null, 2) };
  }

  const after = kaneRun.afterLatest;
  const before = kaneRun.beforeLatest;
  const hasNewSession = after?.resultFile && after.resultFile !== before?.resultFile;
  if (hasNewSession && fs.existsSync(after.resultFile)) {
    const sessionText = readTextMaybe(after.resultFile);
    writeFile(resultFile, JSON.stringify({
      source: "kane_power_session_created_by_run",
      sourceFile: after.resultFile,
      parsed: parseKaneResults(sessionText, after.resultFile),
    }, null, 2));
    return { source: "kane_power_session_created_by_run", file: resultFile, text: sessionText, sourceFile: after.resultFile };
  }

  if (!kaneRun.triggered && after?.resultFile && fs.existsSync(after.resultFile)) {
    const sessionText = readTextMaybe(after.resultFile);
    writeFile(resultFile, JSON.stringify({
      source: "existing_kane_power_session",
      sourceFile: after.resultFile,
      parsed: parseKaneResults(sessionText, after.resultFile),
    }, null, 2));
    return { source: "existing_kane_power_session", file: resultFile, text: sessionText, sourceFile: after.resultFile };
  }

  const fallback = {
    event: "verification_failed",
    status: "failed",
    behavior: options.behavior,
    failure: kaneRun.result.error || kaneRun.result.stderr || "Kane did not return parseable verification output.",
    evidence: ["Kane run log: .tmp/kane-run.log"],
    raw_result: {
      command: kaneRun.result.command,
      exitStatus: kaneRun.result.status,
      error: kaneRun.result.error,
      timedOut: kaneRun.result.timedOut,
    },
  };
  writeFile(resultFile, JSON.stringify(fallback, null, 2));
  return { source: "kane_execution_gap", file: resultFile, text: JSON.stringify(fallback) };
}

function createBaseEvent(options, sessionId, name, overrides) {
  return {
    id: id(sessionId, name),
    timestamp: overrides.timestamp || new Date().toISOString(),
    source: "system",
    type: "task",
    status: "tasked",
    label: name,
    parentId: null,
    branchId: options.branch,
    intent: options.feature,
    metadata: {
      controlTowerStep: true,
      featureKey: options.feature,
      featureTitle: options.featureTitle,
      realLoopSessionId: sessionId,
      kaneBehavior: options.behavior,
    },
    ...overrides,
    metadata: {
      controlTowerStep: true,
      featureKey: options.feature,
      featureTitle: options.featureTitle,
      realLoopSessionId: sessionId,
      kaneBehavior: options.behavior,
      ...(overrides.metadata || {}),
    },
  };
}

function codexPmEventDetails(result) {
  const plan = result.plan || {};
  return [
    "Model: " + (result.model || "(not configured)"),
    "Run log: .tmp/codex-run.log",
    "Plan snapshot: .tmp/codex-pm-plan.json",
    ...(plan.developmentPlan || []).slice(0, 4).map((step, index) => "Plan " + String(index + 1) + ": " + step),
    ...(plan.acceptanceCriteria || []).slice(0, 4).map((criterion) => "Accept: " + criterion),
    result.error ? "PM note: " + result.error : "",
  ].filter(Boolean);
}

function codexPmEventMetadata(result, extra = {}) {
  return {
    codexPmExecuted: result.apiExecuted === true,
    codexPmFallback: result.apiExecuted !== true,
    codexPmModel: result.model,
    codexPmApiKeySource: result.apiKeySource || "",
    executionCommand: result.apiExecuted ? "POST https://api.openai.com/v1/responses" : "",
    executionExitStatus: typeof result.responseStatus === "number" ? result.responseStatus : undefined,
    executionArtifacts: [".tmp/codex-run.log", ".tmp/codex-pm-plan.json", ".tmp/codex-goal.md"],
    ...extra,
  };
}

function codexReframedGoalEvent(options, sessionId, parentId, result) {
  return createBaseEvent(options, sessionId, "codex_pm_reframed_goal", {
    source: "codex",
    type: "plan",
    status: "planned",
    label: "Codex PM Reframed Goal",
    parentId,
    branchId: "main",
    summary: result.plan.reframedGoal,
    detail: [result.plan.reframedGoal],
    metadata: codexPmEventMetadata(result, { codexPmStage: "reframed_goal" }),
  });
}

function codexPlanGeneratedEvent(options, sessionId, parentId, result) {
  return createBaseEvent(options, sessionId, "codex_pm_plan_generated", {
    source: "codex",
    type: "plan",
    status: "planned",
    label: result.apiExecuted ? "Codex PM Plan Generated" : "Codex PM fallback mode",
    parentId,
    branchId: "main",
    summary: result.apiExecuted
      ? "Real Codex PM generated the development plan, acceptance criteria, Kiro build task, and Kane verification task."
      : "OpenBranch generated the PM plan locally because the Codex/OpenAI API did not run.",
    detail: codexPmEventDetails(result),
    metadata: codexPmEventMetadata(result, { codexPmStage: result.apiExecuted ? "plan_generated" : "fallback" }),
  });
}

function codexAcceptedLessonEvent(options, sessionId, parentId, result, kaneOutcome) {
  return createBaseEvent(options, sessionId, "codex_pm_accepted_lesson", {
    source: "codex",
    type: "merge",
    status: "merged",
    label: "Codex PM Accepted Lesson",
    parentId,
    branchId: "main",
    mergeParentIds: kaneOutcome?.id ? [kaneOutcome.id] : [],
    summary: result.plan.acceptedLesson || "Codex PM accepted the lesson after reviewing Kane feedback.",
    detail: [
      "Kane outcome: " + (kaneOutcome?.label || "unknown"),
      "Next action: " + (result.plan.nextActionAfterKaneFeedback || "Accept verified behavior or create the next fix branch."),
      ...codexPmEventDetails(result),
    ],
    metadata: codexPmEventMetadata(result, {
      codexPmStage: "accepted_lesson",
      executionArtifacts: [".tmp/codex-run.log", ".tmp/codex-pm-feedback.json", ".tmp/kane-result.json"],
    }),
  });
}

function kiroEvent(options, sessionId, parentId, kiroRun) {
  const executed = kiroRun.status === 0;
  return createBaseEvent(options, sessionId, executed ? "kiro_builder_executed" : "kiro_task_prepared", {
    source: "kiro",
    type: executed ? "build_attempt" : "task",
    status: executed ? "building" : "tasked",
    label: executed ? "Kiro Builder Executed" : "Kiro Task Prepared",
    parentId,
    branchId: options.branch,
    summary: executed
      ? "OpenBranch invoked Kiro CLI with the builder task. No file implementation is claimed unless the run log or later diff proves it."
      : "OpenBranch prepared the Kiro task, but Kiro did not execute successfully.",
    detail: [
      "Builder task: .tmp/kiro-build-task.md",
      "Kiro run log: .tmp/kiro-run.log",
      "Exit status: " + (kiroRun.status === null ? "(none)" : kiroRun.status),
      kiroRun.error ? "Execution error: " + kiroRun.error : "",
      "Claim boundary: this is an execution record, not proof of implemented code.",
    ].filter(Boolean),
    metadata: {
      kiroExecuted: executed,
      executionCommand: kiroRun.command,
      executionExitStatus: kiroRun.status,
      executionArtifacts: [".tmp/kiro-run.log", ".tmp/kiro-capabilities.json"],
    },
  });
}

function fallbackKaneOutcomeEvent(options, sessionId, parentId, kaneRun, snapshot) {
  return createBaseEvent(options, sessionId, "verification_failed", {
    source: "kane",
    type: "fail",
    status: "failed",
    label: "Verification Failed",
    parentId,
    branchId: options.branch,
    summary: kaneRun.triggered
      ? "Kane CLI was invoked, but it did not produce a passing verification result."
      : "Kane CLI was not invoked by OpenBranch; the verifier result is unavailable.",
    detail: [
      "Kane run log: .tmp/kane-run.log",
      "Kane result snapshot: .tmp/kane-result.json",
      "Result source: " + snapshot.source,
      kaneRun.result.error ? "Execution error: " + kaneRun.result.error : "",
      kaneRun.result.stderr ? "stderr: " + kaneRun.result.stderr.trim().slice(0, 600) : "",
    ].filter(Boolean),
    metadata: {
      kaneExecuted: kaneRun.triggered,
      kaneExecutionAttempted: kaneRun.triggered,
      kaneVerified: false,
      executionFailure: true,
      executionCommand: kaneRun.result.command,
      executionExitStatus: kaneRun.result.status,
      executionArtifacts: [".tmp/kane-run.log", ".tmp/kane-capabilities.json", ".tmp/kane-result.json"],
    },
  });
}

function kaneExecutionEvent(options, sessionId, parentId, kaneRun) {
  if (!kaneRun.triggered) {
    return createBaseEvent(options, sessionId, "kane_result_ingested", {
      source: "kane",
      type: "verify",
      status: "verifying",
      label: "Kane Result Ingested",
      parentId,
      branchId: options.branch,
      summary: "OpenBranch could not trigger Kane CLI, so it ingested an existing local Kane Power result if one was available.",
      detail: ["Kane run log: .tmp/kane-run.log", "Kane capabilities: .tmp/kane-capabilities.json"],
      metadata: {
        kaneExecuted: false,
        kaneExecutionAttempted: false,
        existingKaneRun: true,
        executionArtifacts: [".tmp/kane-run.log", ".tmp/kane-capabilities.json"],
      },
    });
  }

  return createBaseEvent(options, sessionId, "kane_verifier_executed", {
    source: "kane",
    type: "verify",
    status: "verifying",
    label: "Kane Verifier Executed",
    parentId,
    branchId: options.branch,
    summary: "OpenBranch invoked Kane CLI with `--agent` and captured the run log for Story View Technical Details.",
    detail: [
      "Kane run log: .tmp/kane-run.log",
      "Kane result snapshot: .tmp/kane-result.json",
      "Exit status: " + (kaneRun.result.status === null ? "(none)" : kaneRun.result.status),
    ],
    metadata: {
      kaneExecuted: true,
      kaneExecutionAttempted: true,
      executionCommand: kaneRun.result.command,
      executionExitStatus: kaneRun.result.status,
      executionArtifacts: [".tmp/kane-run.log", ".tmp/kane-capabilities.json", ".tmp/kane-result.json"],
    },
  });
}

function decorateKaneEvents(events, options, kaneRun, snapshot) {
  return events.map((event) => {
    const passed = event.type === "pass";
    const failed = event.type === "fail";
    const existing = snapshot.source === "existing_kane_power_session";
    const executed = kaneRun.triggered;
    return {
      ...event,
      label: passed
        ? executed
          ? "Verification Passed"
          : "Existing Kane Result Passed"
        : failed
          ? "Verification Failed"
          : executed
            ? "Kane Verifier Executed"
            : "Kane Result Ingested",
      summary: existing
        ? "OpenBranch ingested a real local Kane Power result that existed before this run; it did not trigger that Kane execution."
        : event.summary,
      detail: [
        ...(event.detail || []),
        "Kane run log: .tmp/kane-run.log",
        "Kane capabilities: .tmp/kane-capabilities.json",
        snapshot.sourceFile ? "Kane source file: " + snapshot.sourceFile : "",
      ].filter(Boolean),
      metadata: {
        ...(event.metadata || {}),
        controlTowerStep: true,
        featureKey: options.feature,
        featureTitle: options.featureTitle,
        kaneExecuted: executed,
        kaneExecutionAttempted: executed,
        kaneVerified: executed && (passed || failed),
        existingKaneRun: existing,
        resultSource: snapshot.source,
        executionCommand: kaneRun.result.command,
        executionExitStatus: kaneRun.result.status,
        executionArtifacts: [".tmp/kane-run.log", ".tmp/kane-capabilities.json", ".tmp/kane-result.json"],
      },
    };
  });
}

function nextActionMarkdown(options, outcomeEvent) {
  const metadata = outcomeEvent?.metadata || {};
  const failedBecause = metadata.kaneFailure || outcomeEvent?.summary || "Verification did not pass.";
  const next = metadata.kiroNextAction || "Fix the failing behavior or repair the verifier setup, then rerun `npm run openbranch:real-loop`.";
  return [
    "# Kiro Next Action",
    "",
    "OpenBranch generated this after the real-loop verifier result.",
    "",
    "## Behavior",
    "",
    options.behavior,
    "",
    "## Failure Or Gap",
    "",
    failedBecause,
    "",
    "## Fix Next",
    "",
    next,
    "",
    "## Evidence",
    "",
    "- `.tmp/kiro-run.log`",
    "- `.tmp/kane-run.log`",
    "- `.tmp/kane-result.json`",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  ensureFiles(options);
  const sessionId = "real_loop_" + Date.now().toString(36);
  const baseTs = Date.now();
  const loadedEnv = loadCodexPmEnvFiles({ rootDir, envFile: options.envFile });

  const firstKiroCapabilities = inspectKiro(options);
  const firstKaneCapabilities = inspectKane(options);
  const capabilitySummary = [
    "- Kiro CLI available: " + firstKiroCapabilities.findings.canKiroBeInvokedFromCli,
    "- Kane CLI available: " + firstKaneCapabilities.findings.whetherKaneCliIsAvailable,
    "- Latest real Kane Power output: " + Boolean(firstKaneCapabilities.latestSession),
    "- Codex PM env files loaded: " + (loadedEnv.length ? loadedEnv.map((entry) => rel(entry.file)).join(", ") : "none"),
  ].join("\n");

  const codexInitial = await runCodexPm(options, {
    mode: "initial_plan",
    timeoutMs: options.codexTimeoutMs,
    capabilitySummary,
  });
  codexInitial.envFilesLoaded = loadedEnv.map((entry) => ({
    file: rel(entry.file),
    keys: entry.keys,
  }));
  const codexLogEntries = [codexRunLogEntry(codexInitial, "Codex PM initial plan")];
  writeCodexRunLog(path.join(options.tmpDir, "codex-run.log"), codexLogEntries);
  buildHandoffFiles(options, capabilitySummary, codexInitial.plan, codexInitial.apiExecuted);
  if (options.requireCodexApi && !codexInitial.apiExecuted) {
    throw new Error("Codex PM API did not run. Set OPENAI_API_KEY, or pass --env-file with OPENAI_API_KEY.");
  }

  const kiroRun = runKiro(options, firstKiroCapabilities);
  const beforeKane = latestKanePowerResult();
  const kaneRun = runKane(options, firstKaneCapabilities, beforeKane);
  const snapshot = writeKaneResultSnapshot(options, kaneRun);

  const finalKiroCapabilities = {
    ...firstKiroCapabilities,
    latestRun: {
      executed: kiroRun.status === 0,
      command: kiroRun.command,
      exitStatus: kiroRun.status,
      timedOut: kiroRun.timedOut,
      logFile: path.join(options.tmpDir, "kiro-run.log"),
    },
  };
  const finalKaneCapabilities = {
    ...inspectKane(options),
    latestRun: {
      triggeredByOpenBranch: kaneRun.triggered,
      command: kaneRun.result.command,
      exitStatus: kaneRun.result.status,
      timedOut: kaneRun.result.timedOut,
      logFile: path.join(options.tmpDir, "kane-run.log"),
      resultFile: path.join(options.tmpDir, "kane-result.json"),
      resultSource: snapshot.source,
      latestSessionAfterRun: kaneRun.afterLatest?.resultFile || "",
    },
  };
  writeFile(path.join(options.tmpDir, "kiro-capabilities.json"), JSON.stringify(finalKiroCapabilities, null, 2));
  writeFile(path.join(options.tmpDir, "kane-capabilities.json"), JSON.stringify(finalKaneCapabilities, null, 2));

  const goalEvent = appendEvent(options.eventsFile, createBaseEvent(options, sessionId, "user_goal", {
    timestamp: shiftedIso(baseTs, 0),
    source: "user",
    type: "goal",
    status: "goal",
    label: "User Goal",
    parentId: null,
    branchId: "main",
    summary: options.goal,
    detail: ["Goal file: .tmp/openbranch-goal.md"],
  }));

  let codexParentId = goalEvent.id;
  if (codexInitial.apiExecuted) {
    const reframeEvent = appendEvent(options.eventsFile, {
      ...codexReframedGoalEvent(options, sessionId, goalEvent.id, codexInitial),
      timestamp: shiftedIso(baseTs, 250),
    });
    codexParentId = reframeEvent.id;
  }

  const planEvent = appendEvent(options.eventsFile, {
    ...codexPlanGeneratedEvent(options, sessionId, codexParentId, codexInitial),
    timestamp: shiftedIso(baseTs, 350),
  });

  const buildEvent = appendEvent(options.eventsFile, {
    ...kiroEvent(options, sessionId, planEvent.id, kiroRun),
    timestamp: shiftedIso(baseTs, 700),
  });

  const verifyEvent = appendEvent(options.eventsFile, {
    ...kaneExecutionEvent(options, sessionId, buildEvent.id, kaneRun),
    timestamp: shiftedIso(baseTs, 1050),
  });

  const records = parseKaneResults(snapshot.text || "", snapshot.sourceFile || snapshot.file);
  const kaneEvents = records.length
    ? (() => {
        const rawEvents = kaneResultsToOpenBranchEvents(records, {
          inputFile: snapshot.sourceFile || snapshot.file,
          parent: verifyEvent.id,
          branch: options.branch,
          feature: options.feature,
          featureTitle: options.featureTitle,
        }).filter((event) => event.type !== "verify");
        const visibleIds = new Set([verifyEvent.id, ...rawEvents.map((event) => event.id)]);
        return decorateKaneEvents(rawEvents, options, kaneRun, snapshot).map((event) => ({
          ...event,
          parentId: event.parentId && visibleIds.has(event.parentId) ? event.parentId : verifyEvent.id,
        }));
      })()
    : [fallbackKaneOutcomeEvent(options, sessionId, verifyEvent.id, kaneRun, snapshot)];
  appendEvents(options.eventsFile, kaneEvents);

  const outcome = [...kaneEvents].reverse().find((event) => event.type === "pass" || event.type === "fail") || kaneEvents[kaneEvents.length - 1];
  let codexAfterKane = null;
  if (codexInitial.apiExecuted && outcome) {
    codexAfterKane = await runCodexPm(options, {
      mode: outcome.type === "pass" ? "accept_after_kane" : "next_action_after_kane",
      timeoutMs: options.codexTimeoutMs,
      previousPlan: codexInitial.plan,
      kaneFeedback: JSON.stringify({
        label: outcome.label,
        type: outcome.type,
        status: outcome.status,
        summary: outcome.summary,
        detail: outcome.detail,
        metadata: outcome.metadata,
      }, null, 2),
    });
    codexAfterKane.envFilesLoaded = codexInitial.envFilesLoaded;
    codexLogEntries.push(codexRunLogEntry(codexAfterKane, "Codex PM after Kane feedback"));
    writeCodexRunLog(path.join(options.tmpDir, "codex-run.log"), codexLogEntries);
    writeFile(path.join(options.tmpDir, "codex-pm-feedback.json"), JSON.stringify(codexAfterKane.plan, null, 2));
  }

  if (outcome?.type === "pass") {
    let mergeParentId = outcome.id;
    let mergeParents = [outcome.id];
    if (codexAfterKane?.apiExecuted) {
      const acceptedByPm = appendEvent(options.eventsFile, {
        ...codexAcceptedLessonEvent(options, sessionId, outcome.id, codexAfterKane, outcome),
        timestamp: shiftedIso(baseTs, 1600),
      });
      mergeParentId = acceptedByPm.id;
      mergeParents = [acceptedByPm.id];
    }
    appendEvent(options.eventsFile, createBaseEvent(options, sessionId, "accepted_lesson", {
      timestamp: shiftedIso(baseTs, 1750),
      source: "merge",
      type: "merge",
      status: "merged",
      label: "Accepted Lesson",
      parentId: goalEvent.id,
      branchId: "main",
      mergeParentIds: mergeParents,
      summary: codexAfterKane?.apiExecuted
        ? "OpenBranch accepts the lesson after real Codex PM reviewed Kane's passing evidence."
        : kaneRun.triggered
          ? "OpenBranch accepts the lesson because a Kane CLI run produced passing evidence."
          : "OpenBranch records the lesson from an existing real Kane Power result without claiming it triggered the run.",
      detail: [
        "Kane result snapshot: .tmp/kane-result.json",
        codexAfterKane?.apiExecuted ? "Codex PM feedback: .tmp/codex-pm-feedback.json" : "",
        "Execution evidence is in Technical Details.",
      ].filter(Boolean),
      metadata: {
        acceptedFromRealExecution: kaneRun.triggered,
        acceptedFromExistingKaneRun: !kaneRun.triggered,
        acceptedByCodexPmApi: codexAfterKane?.apiExecuted === true,
        executionArtifacts: [
          ".tmp/kane-result.json",
          ".tmp/kane-run.log",
          ...(codexAfterKane?.apiExecuted ? [".tmp/codex-run.log", ".tmp/codex-pm-feedback.json"] : []),
        ],
      },
    }));
  } else if (outcome?.type === "fail") {
    const nextAction = codexAfterKane?.apiExecuted
      ? [
          "# Kiro Next Action",
          "",
          "Real Codex PM generated this after Kane feedback.",
          "",
          codexAfterKane.plan.nextActionAfterKaneFeedback,
          "",
          "## Updated Kiro Build Task",
          "",
          codexAfterKane.plan.kiroBuildTask,
        ].join("\n")
      : nextActionMarkdown(options, outcome);
    writeFile(path.join(options.tmpDir, "kiro-next-action.md"), nextAction);
    appendEvent(options.eventsFile, createBaseEvent(options, sessionId, "ai_fix_branch", {
      timestamp: shiftedIso(baseTs, 1750),
      source: "agent",
      type: "fix_branch",
      status: "branching",
      label: "AI Fix Branch",
      parentId: outcome.id,
      branchId: "fix/" + options.feature,
      summary: "OpenBranch keeps the failed verification visible and creates a fix branch with the next action.",
      detail: [
        "Next action: .tmp/kiro-next-action.md",
        codexAfterKane?.apiExecuted ? "Real Codex PM feedback: .tmp/codex-pm-feedback.json" : "",
      ].filter(Boolean),
      metadata: {
        codexPmExecuted: codexAfterKane?.apiExecuted === true,
        executionArtifacts: [
          ".tmp/kiro-next-action.md",
          ".tmp/kane-run.log",
          ".tmp/kane-result.json",
          ...(codexAfterKane?.apiExecuted ? [".tmp/codex-run.log", ".tmp/codex-pm-feedback.json"] : []),
        ],
      },
    }));
  }

  console.log("");
  console.log("Real loop complete.");
  console.log("Codex PM API ran: " + (codexInitial.apiExecuted ? "yes" : "no"));
  console.log("Kiro actually ran: " + (kiroRun.status === 0 ? "yes" : "no"));
  console.log("Kane actually ran: " + (kaneRun.triggered ? "yes" : "no"));
  console.log("Kane result source: " + snapshot.source);
}

main().catch((error) => {
  console.error((error && error.message) || error);
  process.exitCode = 1;
});
