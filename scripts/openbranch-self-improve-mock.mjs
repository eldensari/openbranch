import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseKaneResults } from "./kane-result-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function usage() {
  return [
    "Usage: npm run openbranch:self-improve:mock -- [--reset]",
    "",
    "Creates a safe fallback Mock Demo story:",
    "- no API keys required",
    "- no Kiro required; PM and Kiro are labeled as simulated",
    "- attempts a real Kane CLI case when kane-cli is available",
    "- falls back to fixture Kane cases when Kane cannot run or cannot produce a pass",
    "- writes .tmp/self-improve-mock-report.md and .tmp/kane-case-results.json",
    "- appends the same Story View events used by the in-app Run Mock Demo button",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    eventsFile: path.join(rootDir, "events.jsonl"),
    tmpDir: path.join(rootDir, ".tmp"),
    reset: false,
    skipKane: false,
    kaneTimeoutMs: 30_000,
    kaneMaxSteps: 5,
    title: "Mock Demo: Self-Improvement Fallback",
    prompt: "Show the safe fallback OpenBranch self-improvement story for a live hackathon demo.",
    behavior: "Verify that OpenBranch can present a Mock Demo Story View with simulated PM/Kiro, Kane evidence, a fix branch, a pass, and an accepted lesson.",
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
    else if (arg === "--title") options.title = readValue();
    else if (arg === "--prompt") options.prompt = readValue();
    else if (arg === "--behavior") options.behavior = readValue();
    else if (arg === "--kane-timeout-ms") options.kaneTimeoutMs = Number(readValue()) || options.kaneTimeoutMs;
    else if (arg === "--kane-max-steps") options.kaneMaxSteps = Number(readValue()) || options.kaneMaxSteps;
    else if (arg === "--skip-kane") options.skipKane = true;
    else if (arg === "--reset") options.reset = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("Unknown argument: " + arg);
  }

  return options;
}

function normalizePath(file) {
  return String(file || "").replace(/\\/g, "/");
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

function ensureFiles(options) {
  fs.mkdirSync(options.tmpDir, { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(options.eventsFile)), { recursive: true });
  if (options.reset || !fs.existsSync(options.eventsFile)) fs.writeFileSync(options.eventsFile, "");
}

function userHome() {
  return process.env.USERPROFILE || process.env.HOME || "";
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

function runCommand(command, args = [], options = {}) {
  const startedAt = new Date();
  const line = Array.isArray(args) ? commandLine(command, args) : String(command);
  const result = spawnSync(line, {
    cwd: options.cwd || rootDir,
    shell: true,
    encoding: "utf8",
    timeout: options.timeoutMs || 30_000,
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

function writeRunLog(file, title, result) {
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
    "",
    "STDOUT:",
    result?.stdout || "",
    "",
    "STDERR:",
    result?.stderr || "",
  ].join("\n"));
}

function fixtureRecords(root) {
  const failureFile = path.join(root, "fixtures", "kane", "failure.ndjson");
  const passFile = path.join(root, "fixtures", "kane", "pass.json");
  return {
    failureFile,
    passFile,
    failureRecords: parseKaneResults(fs.readFileSync(failureFile, "utf8"), failureFile),
    passRecords: parseKaneResults(fs.readFileSync(passFile, "utf8"), passFile),
  };
}

function outcome(record) {
  const raw = String(record?.event || record?.status || record?.outcome || "").toLowerCase();
  if (raw.includes("fail") || raw.includes("error") || raw.includes("reject")) return "failed";
  if (raw.includes("pass") || raw.includes("success") || raw.includes("complete") || raw.includes("ok")) return "passed";
  return "";
}

function firstString(record, keys, fallback = "") {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return fallback;
}

function stringList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return firstString(item, ["message", "summary", "path"], JSON.stringify(item));
      return String(item);
    })
    .filter(Boolean);
}

function caseFields(record, fallback) {
  return {
    behavior: firstString(record, ["behavior", "objective", "tested", "test", "check", "name", "title"], fallback.behavior),
    summary: firstString(record, ["summary", "reason"], fallback.summary),
    failure: firstString(record, ["failure", "error", "message", "reason"], fallback.failure),
    evidence: stringList(record?.evidence || record?.artifacts || record?.logs || fallback.evidence),
    nextAction: firstString(record, ["kiro_next_action", "kiroNextAction", "next_action", "fix", "recommendation"], fallback.nextAction),
    files: stringList(record?.files || record?.file || record?.path),
  };
}

function runKaneCase(options) {
  const fixtures = fixtureRecords(rootDir);
  const fixtureFailure = fixtures.failureRecords.find((record) => outcome(record) === "failed") || fixtures.failureRecords[0] || {};
  const fixturePass = fixtures.passRecords.find((record) => outcome(record) === "passed") || fixtures.passRecords[0] || {};
  const command = options.skipKane ? "" : commandExists("kane-cli");
  const unavailable = {
    command: "",
    cwd: rootDir,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 0,
    status: null,
    signal: null,
    error: options.skipKane ? "Skipped by --skip-kane." : "kane-cli was not available.",
    timedOut: false,
    stdout: "",
    stderr: "",
  };

  let run = unavailable;
  let records = [];
  if (command) {
    const timeoutSeconds = String(Math.ceil(options.kaneTimeoutMs / 1000));
    run = process.env.OPENBRANCH_KANE_COMMAND
      ? runCommand(process.env.OPENBRANCH_KANE_COMMAND, null, { timeoutMs: options.kaneTimeoutMs + 2_000 })
      : runCommand(command, [
          "run",
          options.behavior,
          "--agent",
          "--headless",
          "--timeout",
          timeoutSeconds,
          "--max-steps",
          String(options.kaneMaxSteps),
        ], { timeoutMs: options.kaneTimeoutMs + 2_000 });
    records = parseKaneResults(run.stdout || "", path.join(options.tmpDir, "kane-run.log"));
  }

  writeRunLog(path.join(options.tmpDir, "kane-run.log"), "OpenBranch Mock Demo Kane run", run);

  const realFailure = records.find((record) => outcome(record) === "failed") || null;
  const realPass = records.find((record) => outcome(record) === "passed") || null;
  const attempted = Boolean(command);
  const canUseRealPass = Boolean(realPass && run.status === 0 && !run.timedOut);
  const fixtureFallback = !canUseRealPass;
  const mode = canUseRealPass
    ? "real_kane_cli"
    : attempted
      ? "real_kane_cli_with_fixture_fallback"
      : "fixture_fallback";

  return {
    generatedAt: new Date().toISOString(),
    mode,
    kaneAvailable: Boolean(command),
    kaneAttempted: attempted,
    kanePassed: canUseRealPass,
    fixtureFallback,
    fallbackReason: fixtureFallback
      ? attempted
        ? (run.timedOut ? "Kane CLI timed out before producing a passing case." : "Kane CLI did not produce a passing case for the mock demo.")
        : "Kane CLI was not available, so OpenBranch used fixture fallback cases."
      : "",
    command: run.command,
    exitStatus: run.status,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    realRecords: records,
    fixtureRecords: {
      failureFile: rel(fixtures.failureFile),
      passFile: rel(fixtures.passFile),
      failureRecords: fixtures.failureRecords,
      passRecords: fixtures.passRecords,
    },
    storyCases: {
      round1Issue: realFailure || fixtureFailure,
      round3Pass: canUseRealPass ? realPass : fixturePass,
      round1Source: realFailure ? "real_kane_cli" : "fixture_fallback",
      round3Source: canUseRealPass ? "real_kane_cli" : "fixture_fallback",
    },
  };
}

function shiftedIso(baseMs, offsetMs) {
  return new Date(baseMs + offsetMs).toISOString();
}

function createEvent(context, overrides) {
  return {
    id: context.sessionId + "_" + overrides.key,
    timestamp: shiftedIso(context.baseMs, overrides.offsetMs || 0),
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
    intent: "self-improve-mock-demo",
    metadata: {
      controlTowerStep: true,
      teamLoopSessionId: context.sessionId,
      mockDemo: true,
      featureKey: "self-improve-mock-demo",
      featureTitle: context.title,
      pmMode: "simulated",
      kiroMode: "simulated",
      role: overrides.role,
      ...(overrides.metadata || {}),
    },
  };
}

function buildEvents(context, kaneCase) {
  const round1 = caseFields(kaneCase.storyCases.round1Issue, {
    behavior: context.behavior,
    summary: "Kane reports that the first fallback story needs a clearer failure and repair path.",
    failure: "The fallback path is present, but judges cannot immediately tell PM/Kiro are simulated and Kane evidence is labeled.",
    evidence: ["Fixture fallback issue: the mock story needs explicit source labels."],
    nextAction: "Make the mock session label, simulated PM/Kiro steps, Kane source, pass, and accepted lesson unmistakable.",
  });
  const round3 = caseFields(kaneCase.storyCases.round3Pass, {
    behavior: context.behavior,
    summary: "Kane passes the fallback story after the source labels and accepted lesson are visible.",
    failure: "",
    evidence: ["Fixture fallback pass: Story View includes simulated PM/Kiro, Kane source, fix branch, and accepted lesson."],
    nextAction: "Accept the lesson into main.",
  });
  const kaneModeLabel = kaneCase.mode === "real_kane_cli"
    ? "Real Kane CLI case"
    : kaneCase.kaneAttempted
      ? "Kane CLI attempted; fixture fallback for pass"
      : "Fixture fallback";
  const firstBranch = "mock/round-1-attempt";
  const fixBranch = "mock/round-2-fix";
  const passBranch = "mock/round-3-pass";

  const session = createEvent(context, {
    key: "session",
    offsetMs: -250,
    source: "system",
    type: "session",
    status: "active",
    label: "Mock Demo session: Self-Improvement Fallback",
    branchId: "main",
    summary: "Emergency presentation path: simulated PM/Kiro, Kane real when available, fixture fallback when not.",
    detail: [
      "This session is labeled Mock Demo.",
      "PM is simulated; no API key is required.",
      "Kiro is simulated; no Kiro invocation is required.",
      "Kane source: " + kaneModeLabel + ".",
    ],
    role: "OpenBranch",
    metadata: { kaneMode: kaneCase.mode },
  });
  const goal = createEvent(context, {
    key: "goal",
    offsetMs: 0,
    source: "user",
    type: "goal",
    status: "goal",
    label: "Mock Demo Goal: show safe fallback path",
    parentId: session.id,
    branchId: "main",
    summary: context.prompt,
    detail: ["A judge should be able to click one button and see the intended OpenBranch experience without terminal commands."],
    role: "user",
  });
  const r1Pm = createEvent(context, {
    key: "round1_mock_pm",
    offsetMs: 350,
    source: "codex",
    type: "plan",
    status: "planned",
    label: "Round 1: Mock PM sets the target",
    parentId: goal.id,
    branchId: "main",
    summary: "Mock PM defines the demo-safe target: make the fallback path obvious, labeled, and trustworthy.",
    detail: [
      "Simulated PM: no OPENAI_API_KEY required.",
      "Target: show PM/Kiro simulation, Kane source, failure, fix branch, pass, and accepted lesson.",
    ],
    role: "Mock PM",
  });
  const r1Kiro = createEvent(context, {
    key: "round1_mock_kiro_attempt",
    offsetMs: 700,
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Round 1: Mock Kiro first attempt",
    parentId: r1Pm.id,
    branchId: firstBranch,
    summary: "Mock Kiro creates the first fallback path but leaves the source labels too easy to miss.",
    detail: [
      "Simulated Kiro: no Kiro CLI required.",
      "Branch: " + firstBranch,
      "Assumption: a fallback story is enough even if PM/Kiro/Kane source labels are subtle.",
    ],
    role: "Mock Kiro",
  });
  const r1Kane = createEvent(context, {
    key: "round1_kane_issue",
    offsetMs: 1050,
    source: "kane",
    type: "fail",
    status: "failed",
    label: kaneCase.storyCases.round1Source === "real_kane_cli"
      ? "Round 1: Kane CLI reports issue"
      : "Round 1: Kane reports issue (fixture fallback)",
    parentId: r1Kiro.id,
    branchId: firstBranch,
    summary: round1.failure || round1.summary,
    detail: [
      "Kane source: " + (kaneCase.storyCases.round1Source === "real_kane_cli" ? "real Kane CLI output" : "fixture fallback"),
      "Kane tested: " + round1.behavior,
      "Failure: " + (round1.failure || round1.summary),
      "Kiro should fix next: " + round1.nextAction,
      ...round1.evidence.slice(0, 4).map((item) => "Evidence: " + item),
      kaneCase.fallbackReason ? "Fallback note: " + kaneCase.fallbackReason : "",
    ].filter(Boolean),
    files: round1.files.length ? round1.files : [".tmp/kane-case-results.json"],
    role: "Kane Verifier",
    metadata: {
      kaneMode: kaneCase.mode,
      kaneExecuted: kaneCase.kaneAttempted,
      kaneFixtureFallback: kaneCase.storyCases.round1Source !== "real_kane_cli",
      kaneCaseResults: ".tmp/kane-case-results.json",
      kaneBehavior: round1.behavior,
      kaneFailure: round1.failure || round1.summary,
      kiroNextAction: round1.nextAction,
      kaneEvidence: round1.evidence,
    },
  });
  const r2Pm = createEvent(context, {
    key: "round2_mock_pm_reframes",
    offsetMs: 1400,
    source: "codex",
    type: "plan",
    status: "planned",
    label: "Round 2: Mock PM reframes",
    parentId: r1Kane.id,
    branchId: "main",
    summary: "Mock PM reframes the work from 'have a fallback' to 'make source and trust obvious under pressure.'",
    detail: [
      "Simulated PM reframing: label the session Mock Demo.",
      "Simulated PM reframing: call out PM/Kiro simulation and Kane real-vs-fixture evidence.",
    ],
    role: "Mock PM",
  });
  const r2Kiro = createEvent(context, {
    key: "round2_mock_kiro_fix",
    offsetMs: 1750,
    source: "kiro",
    type: "fix_branch",
    status: "branching",
    label: "Round 2: Mock Kiro fixes labels",
    parentId: r2Pm.id,
    branchId: fixBranch,
    summary: "Mock Kiro adds visible Mock Demo labeling, source badges, and a dedicated fallback path.",
    detail: [
      "Branch: " + fixBranch,
      "Simulated Kiro change: separate the fallback from the primary prompt flow.",
      "Simulated Kiro change: keep the graph and Story View experience identical to the CLI mock demo.",
    ],
    role: "Mock Kiro",
  });
  const r3Kane = createEvent(context, {
    key: "round3_kane_pass",
    offsetMs: 2200,
    source: "kane",
    type: "pass",
    status: "passed",
    label: kaneCase.storyCases.round3Source === "real_kane_cli"
      ? "Round 3: Kane CLI passes"
      : "Round 3: Kane passes (fixture fallback)",
    parentId: r2Kiro.id,
    branchId: passBranch,
    summary: round3.summary || "Kane passes after the mock fallback story labels the source of every step.",
    detail: [
      "Kane source: " + (kaneCase.storyCases.round3Source === "real_kane_cli" ? "real Kane CLI output" : "fixture fallback"),
      "Kane tested: " + round3.behavior,
      ...round3.evidence.slice(0, 5).map((item) => "Evidence: " + item),
      "The pass records that PM/Kiro were simulated and Kane source was explicit.",
    ],
    files: round3.files.length ? round3.files : [".tmp/kane-case-results.json"],
    role: "Kane Verifier",
    metadata: {
      kaneMode: kaneCase.mode,
      kaneExecuted: kaneCase.kaneAttempted,
      kaneFixtureFallback: kaneCase.storyCases.round3Source !== "real_kane_cli",
      kaneVerified: true,
      kaneCaseResults: ".tmp/kane-case-results.json",
      kaneBehavior: round3.behavior,
      kaneEvidence: round3.evidence,
    },
  });
  const accepted = createEvent(context, {
    key: "accepted_lesson",
    offsetMs: 2600,
    source: "merge",
    type: "merge",
    status: "merged",
    label: "Accepted lesson: Mock Demo fallback is presentation-safe",
    parentId: goal.id,
    branchId: "main",
    mergeParentIds: [r3Kane.id, r1Kane.id],
    summary: "OpenBranch accepts the lesson: a visible fallback keeps the live demo honest even if the real loop fails.",
    detail: [
      "GitHub tracks code history. OpenBranch tracks AI development history.",
      "Accepted lesson: the fallback path must say which agents are simulated and which verifier evidence is real or fixture-backed.",
      "Artifacts: .tmp/self-improve-mock-report.md and .tmp/kane-case-results.json.",
    ],
    role: "OpenBranch",
  });

  return [session, goal, r1Pm, r1Kiro, r1Kane, r2Pm, r2Kiro, r3Kane, accepted];
}

function appendEvents(eventsFile, events) {
  fs.appendFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  for (const event of events) console.log("+ " + event.label);
}

function buildReport(context, kaneCase, events) {
  return [
    "# OpenBranch Self-Improve Mock Demo Report",
    "",
    "## Session",
    "",
    "- Session ID: `" + context.sessionId + "`",
    "- Label: `Mock Demo`",
    "- Title: " + context.title,
    "",
    "## Execution Contract",
    "",
    "- PM: simulated, no API key required.",
    "- Kiro: simulated, no Kiro CLI required.",
    "- Kane: " + (kaneCase.mode === "real_kane_cli"
      ? "real Kane CLI case produced the passing evidence."
      : kaneCase.kaneAttempted
        ? "Kane CLI was attempted; fixture fallback supplies the passing demo case."
        : "fixture fallback because Kane CLI was not available."),
    kaneCase.fallbackReason ? "- Fallback reason: " + kaneCase.fallbackReason : "",
    "",
    "## Story",
    "",
    "1. Round 1: mock PM/Kiro attempt; Kane reports an issue.",
    "2. Round 2: mock PM reframes; mock Kiro fixes on a branch.",
    "3. Round 3: Kane passes; OpenBranch accepts the lesson and merges to main.",
    "",
    "## Artifacts",
    "",
    "- `.tmp/self-improve-mock-report.md`",
    "- `.tmp/kane-case-results.json`",
    "- `.tmp/kane-run.log`",
    "- `events.jsonl` appended with " + events.length + " Mock Demo events.",
  ].filter(Boolean).join("\n");
}

export function startSelfImproveMockDemo(options = {}) {
  const opts = {
    ...parseArgs([]),
    ...options,
  };
  opts.eventsFile = path.resolve(opts.eventsFile || path.join(rootDir, "events.jsonl"));
  opts.tmpDir = path.resolve(opts.tmpDir || path.join(rootDir, ".tmp"));

  ensureFiles(opts);

  const sessionId = "mock_demo_" + Date.now().toString(36) + "_" + randomUUID().slice(0, 8);
  const context = {
    sessionId,
    title: opts.title,
    prompt: opts.prompt,
    behavior: opts.behavior,
    baseMs: Date.now(),
  };

  const kaneCase = runKaneCase(opts);
  const caseResultsFile = path.join(opts.tmpDir, "kane-case-results.json");
  writeFile(caseResultsFile, JSON.stringify({ sessionId, ...kaneCase }, null, 2));

  const events = buildEvents(context, kaneCase);
  const reportFile = path.join(opts.tmpDir, "self-improve-mock-report.md");
  writeFile(reportFile, buildReport(context, kaneCase, events));
  appendEvents(opts.eventsFile, events);

  return {
    ok: true,
    sessionId,
    title: opts.title,
    mode: "mock_demo",
    kaneMode: kaneCase.mode,
    verificationMode: kaneCase.fixtureFallback ? "fixture_fallback" : "real_kane_cli",
    generatedFiles: [
      ".tmp/self-improve-mock-report.md",
      ".tmp/kane-case-results.json",
      ".tmp/kane-run.log",
    ],
    events,
    eventsText: fs.readFileSync(opts.eventsFile, "utf8"),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const result = startSelfImproveMockDemo(options);
  console.log("");
  console.log("OpenBranch Mock Demo complete.");
  console.log("Session: " + result.sessionId);
  console.log("Kane mode: " + result.kaneMode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
