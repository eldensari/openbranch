import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseKaneResults, kaneResultsToOpenBranchEvents } from "./kane-result-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    eventsFile: path.join(rootDir, "events.jsonl"),
    tmpDir: path.join(rootDir, ".tmp"),
    reset: false,
    goal: "Use OpenBranch as the control tower for a Kiro/Kane/Codex browser-verification loop.",
    feature: "control-tower-loop",
    featureTitle: "Control Tower Loop",
    branch: "feature/control-tower-loop",
    behavior: "OpenBranch creates a development goal, ingests Kane verification, writes the next action, and records the accepted idea.",
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
    else if (arg === "--goal") options.goal = readValue();
    else if (arg === "--feature") options.feature = readValue();
    else if (arg === "--feature-title") options.featureTitle = readValue();
    else if (arg === "--branch") options.branch = readValue();
    else if (arg === "--behavior") options.behavior = readValue();
    else if (arg === "--reset") options.reset = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return options;
}

function usage() {
  return [
    "Usage: npm run openbranch:loop -- [--reset]",
    "",
    "Runs the best available OpenBranch control-tower loop:",
    "- writes .tmp/openbranch-goal.md",
    "- writes .tmp/codex-goal.md",
    "- writes .tmp/kiro-build-task.md",
    "- writes .tmp/kane-verification-task.md",
    "- uses OPENBRANCH_KANE_COMMAND when set",
    "- otherwise ingests Kane Power session output from ~/.testmuai/kaneai/sessions when available",
    "- falls back to fixture Kane output only when no real Kane Power output is present",
    "- writes .tmp/kane-result.json",
    "- writes .tmp/kiro-next-action.md",
    "- appends control-tower story events to events.jsonl",
  ].join("\n");
}

function id(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + randomUUID().slice(0, 8);
}

function ensureFiles(options) {
  fs.mkdirSync(options.tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(options.eventsFile)), { recursive: true });
  if (options.reset || !fs.existsSync(options.eventsFile)) fs.writeFileSync(options.eventsFile, "");
}

function commandExists(command) {
  if (process.platform === "win32") {
    if (command === "kiro") {
      const localKiro = path.join(process.env.LOCALAPPDATA || "", "Programs", "Kiro", "bin", "kiro.cmd");
      if (fs.existsSync(localKiro)) return localKiro;
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

function probeCommand(command) {
  const found = commandExists(command);
  if (!found) return { found: "", runnable: false, error: "" };
  const result = process.platform === "win32" && found.toLowerCase().endsWith(".cmd")
    ? spawnSync(`"${found}" --help`, { encoding: "utf8", timeout: 8000, shell: true })
    : spawnSync(found, ["--help"], { encoding: "utf8", timeout: 8000 });
  return {
    found,
    runnable: result.status === 0,
    error: result.error?.message || (result.status === 0 ? "" : (result.stderr || "").trim()),
  };
}

function userHome() {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function kanePowerInstallFile() {
  return path.join(userHome(), ".kiro", "powers", "installed", "kiro-powers", "POWER.md");
}

function kaneSessionsDir() {
  return path.join(userHome(), ".testmuai", "kaneai", "sessions");
}

function latestKanePowerResult() {
  const sessionsDir = kaneSessionsDir();
  if (!fs.existsSync(sessionsDir)) return null;
  const candidates = [];
  for (const session of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const runsDir = path.join(sessionsDir, session.name, "runs");
    if (!fs.existsSync(runsDir)) continue;
    for (const run of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const runTestDir = path.join(runsDir, run.name, "run-test");
      const actionsFile = path.join(runTestDir, "actions.ndjson");
      const summaryFile = path.join(runTestDir, "run_summary.json");
      const files = [actionsFile, summaryFile].filter((file) => fs.existsSync(file));
      if (!files.length) continue;
      const newest = Math.max(...files.map((file) => fs.statSync(file).mtimeMs));
      candidates.push({
        sessionId: session.name,
        run: run.name,
        runDir: path.join(runsDir, run.name),
        actionsFile: fs.existsSync(actionsFile) ? actionsFile : "",
        summaryFile: fs.existsSync(summaryFile) ? summaryFile : "",
        resultFile: fs.existsSync(actionsFile) ? actionsFile : summaryFile,
        mtimeMs: newest,
      });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

function discoverSurfaces() {
  const kiro = probeCommand("kiro");
  const kaneCli = probeCommand("kane-cli");
  const kaneLegacy = probeCommand("kane");
  const kanePowerFile = kanePowerInstallFile();
  const kanePowerInstalled = fs.existsSync(kanePowerFile);
  const latestKane = latestKanePowerResult();
  const codex = probeCommand("codex");
  return [
    {
      name: "kiro",
      available: Boolean(kiro.runnable || process.env.OPENBRANCH_KIRO_COMMAND),
      mode: process.env.OPENBRANCH_KIRO_COMMAND ? "env_command" : kiro.runnable ? "cli" : "file_bridge",
      command: process.env.OPENBRANCH_KIRO_COMMAND || kiro.found || "kiro chat < .tmp/openbranch-goal.md",
      notes: kiro.runnable ? "Kiro CLI is runnable." : "Using goal file handoff for Kiro.",
    },
    {
      name: "kane",
      available: Boolean(kaneCli.runnable || kaneLegacy.runnable || process.env.OPENBRANCH_KANE_COMMAND || latestKane || kanePowerInstalled),
      mode: process.env.OPENBRANCH_KANE_COMMAND
        ? "env_command"
        : kaneCli.runnable || kaneLegacy.runnable
          ? "cli"
          : latestKane
            ? "kane_power"
            : "fixture",
      command: process.env.OPENBRANCH_KANE_COMMAND || kaneCli.found || kaneLegacy.found || latestKane?.resultFile || "fixture: fixtures/kane/failure.ndjson and fixtures/kane/pass.json",
      notes: process.env.OPENBRANCH_KANE_COMMAND
        ? "Using explicit Kane command from OPENBRANCH_KANE_COMMAND."
        : kaneCli.runnable
          ? "Kane CLI is runnable; use `kane-cli run ... --agent` for NDJSON."
          : kaneLegacy.runnable
            ? "Legacy Kane command is runnable."
            : latestKane
              ? "Using latest Kane Power session output from ~/.testmuai/kaneai/sessions."
              : kanePowerInstalled
                ? "Kane Power is installed, but no session output exists yet and kane-cli is not on PATH."
                : "No runnable Kane CLI or Kane Power output found; using fixtures.",
    },
    {
      name: "codex",
      available: Boolean(codex.runnable || process.env.CODEX_THREAD_ID),
      mode: codex.runnable ? "cli" : process.env.CODEX_THREAD_ID ? "desktop" : "file_bridge",
      command: codex.found || "codex < .tmp/codex-goal.md",
      notes: codex.runnable
        ? "Codex CLI is runnable."
        : process.env.CODEX_THREAD_ID
          ? "Codex Desktop thread is available; using goal file handoff."
          : "Using Codex goal file handoff.",
    },
    {
      name: "file_bridge",
      available: true,
      mode: "file_bridge",
      command: ".tmp/*.md + .tmp/kane-result.json + events.jsonl",
      notes: "Reliable fallback bridge for local demos.",
    },
  ];
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log("wrote " + path.relative(rootDir, file).replace(/\\/g, "/"));
}

function appendEvent(eventsFile, event) {
  fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n");
  console.log("+ " + event.label);
  return event;
}

function appendEvents(eventsFile, events) {
  for (const event of events) appendEvent(eventsFile, event);
}

function goalMarkdown(options, surfaces) {
  return [
    "# OpenBranch Control Tower Goal",
    "",
    options.goal,
    "",
    "## Behavior To Verify",
    "",
    options.behavior,
    "",
    "## Integration Surfaces",
    "",
    ...surfaces.map((surface) => "- " + surface.name + ": " + surface.mode + " (" + surface.notes + ")"),
  ].join("\n");
}

function codexGoalMarkdown(options) {
  return [
    "/goal " + options.goal,
    "",
    "Use these OpenBranch control-tower files:",
    "",
    "- `.tmp/openbranch-goal.md`",
    "- `.tmp/kane-result.json`",
    "- `.tmp/kiro-next-action.md`",
    "- `.tmp/kiro-build-task.md`",
    "- `.tmp/kane-verification-task.md`",
    "",
    "Fix branch: `" + options.branch + "`",
    "Behavior: " + options.behavior,
  ].join("\n");
}

function kiroBuildTaskMarkdown(options) {
  return [
    "# Kiro Builder Task",
    "",
    "Build or prepare this OpenBranch AI development loop:",
    "",
    options.goal,
    "",
    "## Branch",
    "",
    "`" + options.branch + "`",
    "",
    "## Behavior To Support",
    "",
    options.behavior,
  ].join("\n");
}

function kaneVerificationTaskMarkdown(options) {
  return [
    "# Kane Verification Task",
    "",
    "Verify this behavior for the OpenBranch team loop:",
    "",
    options.behavior,
    "",
    "Prefer real Kane Power output from:",
    "",
    "`~/.testmuai/kaneai/sessions/<session-id>/runs/<run>/run-test/actions.ndjson`",
    "",
    "If real output is unavailable, OpenBranch uses fixtures only for demo safety.",
  ].join("\n");
}

function nextActionMarkdown(options, failedEvent) {
  const metadata = failedEvent?.metadata || {};
  const behavior = metadata.kaneBehavior || options.behavior;
  const failure = metadata.kaneFailure || failedEvent?.summary || "Kane reported a failing result.";
  const next = metadata.kiroNextAction || "Patch the branch, then rerun Kane verification.";
  return [
    "# Kiro Next Action",
    "",
    "OpenBranch generated this after ingesting Kane's result.",
    "",
    "## Kane Tested",
    "",
    behavior,
    "",
    "## Failure",
    "",
    failure,
    "",
    "## Fix Next",
    "",
    next,
    "",
    "After fixing, rerun Kane and write the result to `.tmp/kane-result.json`.",
  ].join("\n");
}

function eventBase(options, overrides) {
  return {
    id: id("control"),
    timestamp: new Date().toISOString(),
    parentId: null,
    branchId: options.branch,
    intent: options.feature,
    metadata: {
      controlTowerStep: true,
      featureKey: options.feature,
      featureTitle: options.featureTitle,
      kaneBehavior: options.behavior,
    },
    ...overrides,
  };
}

function readFixtureJson(file) {
  const text = fs.readFileSync(file, "utf8");
  const records = parseKaneResults(text, file);
  return records[records.length - 1] || {};
}

function runCommandToFile(command, outputFile) {
  const result = spawnSync(command, { shell: true, encoding: "utf8" });
  const output = result.stdout || result.stderr || "";
  fs.writeFileSync(outputFile, output);
  return { ok: result.status === 0, output };
}

function writeKanePowerSnapshot(sourceFile, resultFile) {
  const text = fs.readFileSync(sourceFile, "utf8");
  const records = parseKaneResults(text, sourceFile);
  writeFile(resultFile, JSON.stringify({
    source: "kane_power",
    sourceFile,
    results: records,
  }, null, 2));
}

function writeKaneResult(options, phase) {
  const resultFile = path.join(options.tmpDir, "kane-result.json");
  const envCommand = phase === "pass"
    ? process.env.OPENBRANCH_KANE_REVERIFY_COMMAND
    : process.env.OPENBRANCH_KANE_COMMAND;
  if (envCommand) {
    const commandResult = runCommandToFile(envCommand, resultFile);
    if (commandResult.ok) return { file: resultFile, source: "env_command" };
  }
  const kanePower = latestKanePowerResult();
  if (phase === "verify" && kanePower?.resultFile) {
    writeKanePowerSnapshot(kanePower.resultFile, resultFile);
    return { file: resultFile, source: "kane_power", sourceFile: kanePower.resultFile };
  }
  const fixture = phase === "pass"
    ? path.join(rootDir, "fixtures", "kane", "pass.json")
    : path.join(rootDir, "fixtures", "kane", "failure.ndjson");
  const record = readFixtureJson(fixture);
  writeFile(resultFile, JSON.stringify({ ...record, timestamp: new Date().toISOString() }, null, 2));
  return { file: resultFile, source: "fixture", sourceFile: fixture };
}

function kaneEventsFromFile(resultFile, options, parentId, branch) {
  const text = fs.readFileSync(resultFile, "utf8");
  const records = parseKaneResults(text, resultFile);
  return kaneResultsToOpenBranchEvents(records, {
    inputFile: resultFile,
    parent: parentId,
    branch,
    feature: options.feature,
    featureTitle: options.featureTitle,
  }).map((event) => ({
    ...event,
    branchId: branch,
    metadata: {
      ...(event.metadata || {}),
      controlTowerStep: true,
      featureKey: options.feature,
      featureTitle: options.featureTitle,
    },
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  ensureFiles(options);

  const surfaces = discoverSurfaces();
  writeFile(path.join(options.tmpDir, "integration-surfaces.json"), JSON.stringify(surfaces, null, 2));
  writeFile(path.join(options.tmpDir, "openbranch-goal.md"), goalMarkdown(options, surfaces));
  writeFile(path.join(options.tmpDir, "codex-goal.md"), codexGoalMarkdown(options));
  writeFile(path.join(options.tmpDir, "kiro-build-task.md"), kiroBuildTaskMarkdown(options));
  writeFile(path.join(options.tmpDir, "kane-verification-task.md"), kaneVerificationTaskMarkdown(options));

  const goalEvent = appendEvent(options.eventsFile, eventBase(options, {
    source: "user",
    type: "goal",
    status: "goal",
    branchId: "main",
    label: "Goal proposed: " + options.featureTitle,
    summary: options.goal,
  }));

  const buildEvent = appendEvent(options.eventsFile, eventBase(options, {
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Kiro build started: " + options.featureTitle,
    parentId: goalEvent.id,
    summary: "Kiro consumes `.tmp/openbranch-goal.md` and prepares the branch for Kane verification.",
    detail: ["Goal file: .tmp/openbranch-goal.md", "Branch: " + options.branch],
  }));

  const verificationResult = writeKaneResult(options, "verify");
  const verificationEvents = kaneEventsFromFile(verificationResult.file, options, buildEvent.id, options.branch);
  appendEvents(options.eventsFile, verificationEvents);
  const verificationOutcome = [...verificationEvents].reverse().find((event) => event.type === "fail" || event.type === "pass") || verificationEvents[verificationEvents.length - 1];

  if (verificationOutcome?.type === "fail") {
    const nextAction = nextActionMarkdown(options, verificationOutcome);
    writeFile(path.join(options.tmpDir, "kiro-next-action.md"), nextAction);
    const debugEvent = appendEvent(options.eventsFile, eventBase(options, {
      source: "system",
      type: "task",
      status: "tasked",
      label: "Debug instruction generated",
      parentId: verificationOutcome?.id || buildEvent.id,
      summary: "OpenBranch wrote `.tmp/kiro-next-action.md` so Kiro/Codex can fix the failing behavior.",
      detail: ["Next action file: .tmp/kiro-next-action.md"],
    }));

    const fixEvent = appendEvent(options.eventsFile, eventBase(options, {
      source: "agent",
      type: "fix_branch",
      status: "branching",
      branchId: "fix/" + options.feature,
      label: "Fix attempted: " + options.featureTitle,
      parentId: debugEvent.id,
      summary: "Kiro/Codex uses `.tmp/kiro-next-action.md` to patch the issue before re-verification.",
      detail: ["Codex goal file: .tmp/codex-goal.md", "Kiro next action: .tmp/kiro-next-action.md"],
    }));

    if (process.env.OPENBRANCH_KANE_REVERIFY_COMMAND || verificationResult.source === "fixture") {
      const passResult = writeKaneResult(options, "pass");
      const passEvents = kaneEventsFromFile(passResult.file, options, fixEvent.id, "fix/" + options.feature);
      appendEvents(options.eventsFile, passEvents);
      const passEvent = passEvents.find((event) => event.type === "pass") || passEvents[passEvents.length - 1];
      appendEvent(options.eventsFile, eventBase(options, {
        source: "merge",
        type: "merge",
        status: "merged",
        branchId: "main",
        label: "Idea accepted: " + options.featureTitle,
        parentId: goalEvent.id,
        mergeParentIds: passEvent ? [passEvent.id] : [],
        summary: "OpenBranch accepts the idea after Kane re-verification passes.",
      }));
    } else {
      console.log("Kane verification failed from real output. OpenBranch wrote the next action and is waiting for a real re-verification run.");
    }
  } else if (verificationOutcome?.type === "pass") {
    writeFile(path.join(options.tmpDir, "kiro-next-action.md"), [
      "# Kiro Next Action",
      "",
      "Kane verification passed.",
      "",
      "## Behavior Kane Verified",
      "",
      verificationOutcome.metadata?.kaneBehavior || options.behavior,
      "",
      "No fix branch is required unless the team wants additional coverage.",
    ].join("\n"));
    appendEvent(options.eventsFile, eventBase(options, {
      source: "merge",
      type: "merge",
      status: "merged",
      branchId: "main",
      label: "Idea accepted: " + options.featureTitle,
      parentId: goalEvent.id,
      mergeParentIds: [verificationOutcome.id],
      summary: "OpenBranch accepts the idea after real Kane output reports a passing verification.",
    }));
  }

  console.log("OpenBranch loop complete. Switch the app to Live Mode and Story View to watch the control tower trail.");
}

main().catch((error) => {
  console.error((error && error.message) || error);
  process.exitCode = 1;
});
