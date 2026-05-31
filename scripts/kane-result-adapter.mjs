import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

function usage() {
  return [
    "Usage: node scripts/kane-result-adapter.mjs --input <kane-result.json|kane.ndjson> [options]",
    "",
    "Options:",
    "  --events-file <path>       OpenBranch JSONL event file (default: events.jsonl)",
    "  --branch <branch>          Branch to attach Kane events to (default: feature/kane-live-demo)",
    "  --feature <key>            Feature/work unit key (default: kane-live-demo)",
    "  --feature-title <title>    Feature title (default inferred from --feature)",
    "  --parent <event-id>        Parent event id for the first emitted event",
    "  --synthesize-build         Emit a Kiro build_attempt before Kane verification",
    "  --watch                    Keep polling the input file and ingest new content",
    "  --latest-session           Ingest the latest Kane Power actions.ndjson session file",
    "  --watch-sessions           Keep polling Kane Power sessions for new actions.ndjson files",
    "  --sessions-dir <path>      Kane Power sessions dir (default: ~/.testmuai/kaneai/sessions)",
    "  --poll <ms>                Watch poll interval (default: 1000)",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    eventsFile: "events.jsonl",
    branch: "feature/kane-live-demo",
    feature: "kane-live-demo",
    featureTitle: "",
    parent: "",
    synthesizeBuild: false,
    watch: false,
    latestSession: false,
    watchSessions: false,
    sessionsDir: "",
    pollMs: 1000,
    input: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for " + arg);
      i += 1;
      return next;
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--input" || arg === "-i") {
      options.input = readValue();
    } else if (arg === "--events-file") {
      options.eventsFile = readValue();
    } else if (arg === "--branch") {
      options.branch = readValue();
    } else if (arg === "--feature") {
      options.feature = readValue();
    } else if (arg === "--feature-title") {
      options.featureTitle = readValue();
    } else if (arg === "--parent") {
      options.parent = readValue();
    } else if (arg === "--synthesize-build") {
      options.synthesizeBuild = true;
    } else if (arg === "--watch") {
      options.watch = true;
    } else if (arg === "--latest-session") {
      options.latestSession = true;
    } else if (arg === "--watch-sessions") {
      options.watchSessions = true;
    } else if (arg === "--sessions-dir") {
      options.sessionsDir = readValue();
    } else if (arg === "--poll") {
      options.pollMs = Number(readValue()) || options.pollMs;
    } else if (!arg.startsWith("--") && !options.input) {
      options.input = arg;
    } else {
      throw new Error("Unknown argument: " + arg);
    }
  }

  return options;
}

function slugTitle(value) {
  return (value || "kane-live-demo")
    .replace(/^feature\//, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function ensureEventsFile(eventsFile) {
  const dir = path.dirname(path.resolve(eventsFile));
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, "");
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

function userHome() {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function defaultKaneSessionsDir() {
  return path.join(userHome(), ".testmuai", "kaneai", "sessions");
}

function kaneSessionResultFiles(sessionsDir = defaultKaneSessionsDir()) {
  if (!sessionsDir || !fs.existsSync(sessionsDir)) return [];
  const results = [];
  for (const session of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const runsDir = path.join(sessionsDir, session.name, "runs");
    if (!fs.existsSync(runsDir)) continue;
    for (const run of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const runTestDir = path.join(runsDir, run.name, "run-test");
      const actionsFile = path.join(runTestDir, "actions.ndjson");
      if (!fs.existsSync(actionsFile)) continue;
      const stat = fs.statSync(actionsFile);
      results.push({
        file: actionsFile,
        sessionId: session.name,
        run: run.name,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
  return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function stableId(parts) {
  return createHash("sha1").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex").slice(0, 12);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compactJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstString(record, keys, fallback = "") {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return fallback;
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function stringifyList(value) {
  return toArray(value)
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item)) {
        return firstString(item, ["message", "summary", "name", "test", "path"], compactJson(item));
      }
      return String(item);
    })
    .filter(Boolean);
}

function normalizePhase(record) {
  const raw = [
    record.event,
    record.type,
    record.status,
    record.outcome,
    record.verdict,
    record.result,
    record.phase,
    record.level,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();

  if (raw.includes("start") || raw.includes("running") || raw.includes("verifying")) return "started";
  if (raw.includes("bug") || raw.includes("fail") || raw.includes("error") || raw.includes("reject")) return "failed";
  if (raw.includes("pass") || raw.includes("success") || raw.includes("ok") || raw.includes("accept")) return "passed";
  if (record.passed === true || record.success === true || record.ok === true) return "passed";
  if (record.failed === true || record.success === false || record.ok === false) return "failed";
  if (Array.isArray(record.failures) && record.failures.length) return "failed";
  if (Array.isArray(record.bugs) && record.bugs.length) return "failed";
  return "passed";
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function inferKaneRunDir(sourceFile) {
  if (!sourceFile) return "";
  const normalized = path.resolve(sourceFile);
  if (path.basename(path.dirname(normalized)).toLowerCase() === "run-test") {
    return path.dirname(path.dirname(normalized));
  }
  return "";
}

function statusFailed(value) {
  const raw = String(value || "").toLowerCase();
  return raw.includes("fail") || raw.includes("error") || raw.includes("timeout") || raw.includes("stuck");
}

function statusPassed(value) {
  const raw = String(value || "").toLowerCase();
  return raw.includes("pass") || raw.includes("success") || raw.includes("complete") || raw.includes("ok");
}

function assertionFromAction(row) {
  const tree = row?.action_params?.assertion_tree;
  return isRecord(tree) ? tree : null;
}

function isKanePowerActionRow(row) {
  return isRecord(row) && ("action_id" in row || "action_type" in row) && "step" in row && "status" in row;
}

function kanePowerActionRowsToResult(rows, sourceFile) {
  const finalAssertion = [...rows].reverse().map(assertionFromAction).find(Boolean);
  const finalRow = [...rows].reverse().find((row) => row.action_type === "assert") || rows[rows.length - 1] || {};
  const failedRows = rows.filter((row) => row.status !== "success" || row.error || assertionFromAction(row)?.passed === false);
  const passed = failedRows.length === 0 && finalAssertion?.passed !== false;
  const runDir = inferKaneRunDir(sourceFile);
  const screenshotsDir = runDir ? path.join(runDir, "run-test", "screenshots") : "";
  const screenshots = rows
    .map((row) => {
      if (!screenshotsDir || typeof row.step !== "number") return "";
      const shot = path.join(screenshotsDir, "step_" + String(row.step).padStart(3, "0") + ".png");
      return fs.existsSync(shot) ? shot : "";
    })
    .filter(Boolean);
  const behavior =
    finalAssertion?.description ||
    finalAssertion?.verification ||
    firstString(finalRow, ["action_instruction", "intent"], path.basename(sourceFile || "Kane Power actions"));
  const failure =
    finalAssertion?.error_message ||
    firstString(failedRows[0] || {}, ["error", "rationale", "action_instruction"], "");
  const evidence = rows
    .slice(-6)
    .map((row) => "Step " + row.step + " " + (row.action_type || "action") + ": " + (row.action_instruction || row.intent || row.status))
    .filter(Boolean);

  return {
    event: passed ? "verification_passed" : "verification_failed",
    status: passed ? "passed" : "failed",
    behavior,
    summary: passed
      ? "Kane Power completed " + rows.length + " browser action(s)."
      : "Kane Power failed during browser verification.",
    failure,
    evidence: [...evidence, ...screenshots.map((shot) => "Screenshot: " + shot)],
    files: [sourceFile].filter(Boolean),
    source_file: sourceFile,
    run_dir: runDir,
    actions_file: sourceFile,
    raw_result: {
      kind: "kane-power-actions",
      source_file: sourceFile,
      run_dir: runDir,
      steps: rows.length,
      final_status: passed ? "passed" : "failed",
      final_action: finalRow,
    },
  };
}

function kanePowerRunSummaryToResult(value, sourceFile) {
  const steps = Array.isArray(value.steps) ? value.steps : [];
  const failedSteps = steps.filter((step) => step.success === false || statusFailed(step.status));
  const failed = failedSteps.length > 0 || statusFailed(value.final_status) || (Array.isArray(value.errors) && value.errors.length > 0);
  const runDir = inferKaneRunDir(sourceFile);
  return {
    event: failed ? "verification_failed" : "verification_passed",
    status: failed ? "failed" : "passed",
    behavior: firstString(value, ["objective", "name", "title"], path.basename(sourceFile || "Kane Power run")),
    summary: firstString(value, ["reason", "summary"], failed ? "Kane Power reported a failing run." : "Kane Power reported a passing run."),
    failure: failed
      ? stringifyList(value.errors)[0] || firstString(failedSteps[0] || {}, ["action_target", "status"], "Kane Power reported a failing step.")
      : "",
    evidence: steps.slice(-6).map((step) => "Step " + step.step + " " + (step.action_type || "action") + ": " + (step.status || (step.success ? "success" : "failed"))),
    files: [sourceFile].filter(Boolean),
    source_file: sourceFile,
    run_dir: runDir,
    raw_result: {
      kind: "kane-power-run-summary",
      source_file: sourceFile,
      run_dir: runDir,
      final_status: value.final_status,
      reason: value.reason,
      total_steps: value.total_steps,
      errors: value.errors,
    },
  };
}

function flattenKaneJson(value, sourceFile = "") {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.events)) return value.events.filter(isRecord);
  if (Array.isArray(value.results)) return value.results.filter(isRecord);
  if (Array.isArray(value.runs)) {
    return value.runs.filter(isRecord).map((run) => ({
      event: statusFailed(run.status) ? "verification_failed" : "verification_passed",
      behavior: firstString(run, ["objective", "name", "title"], "Kane Power run"),
      summary: firstString(run, ["summary", "reason"], ""),
      failure: statusFailed(run.status) ? firstString(run, ["summary", "reason"], "Kane Power run failed.") : "",
      evidence: statusPassed(run.status) ? stringifyList(run.summary || run.run_dir) : [],
      run_dir: run.run_dir,
      raw_result: { kind: "kane-power-session-run", source_file: sourceFile, ...run },
    }));
  }
  if (Array.isArray(value.steps) && (value.objective || value.final_status || value.run_id)) {
    return [kanePowerRunSummaryToResult(value, sourceFile)];
  }
  if (Array.isArray(value.checks)) {
    return value.checks.filter(isRecord).map((check) => ({ ...value, ...check, raw_result: value }));
  }
  return [value];
}

function parseNdjson(text, sourceFile = "") {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseJsonMaybe(trimmed);
    if (isRecord(parsed)) rows.push(parsed);
  }
  if (rows.length && rows.every(isKanePowerActionRow)) {
    return [kanePowerActionRowsToResult(rows, sourceFile)];
  }
  return rows;
}

function parsePlainText(text, sourceFile) {
  const lower = text.toLowerCase();
  const failed = /\b(fail|failed|error|bug|rejected)\b/.test(lower);
  const passed = /\b(pass|passed|success|ok|accepted)\b/.test(lower);
  if (!failed && !passed) return [];
  return [{
    event: failed ? "verification_failed" : "verification_passed",
    behavior: path.basename(sourceFile || "terminal output"),
    summary: text.trim().slice(0, 1000),
    failure: failed ? text.trim().slice(0, 1000) : "",
    evidence: passed ? [text.trim().slice(0, 1000)] : [],
    raw_output: text,
  }];
}

export function parseKaneResults(text, sourceFile = "") {
  const wholeJson = parseJsonMaybe(text);
  if (wholeJson) return flattenKaneJson(wholeJson, sourceFile);

  const ndjson = parseNdjson(text, sourceFile);
  if (ndjson.length) return ndjson;

  return parsePlainText(text, sourceFile);
}

function kaneFields(record, defaults) {
  const behavior = firstString(record, ["behavior", "objective", "tested", "test", "check", "name", "title", "action_instruction", "verification"], defaults.featureTitle);
  const failure = firstString(record, ["failure", "error", "message", "reason"], "");
  const bugList = stringifyList(record.bugs || record.failures);
  const evidenceList = stringifyList(record.evidence || record.artifacts || record.logs || record.run_dir || record.actions_file || record.source_file);
  const why = firstString(record, ["why_it_matters", "whyItMatters", "impact", "risk"], "");
  const next = firstString(record, ["kiro_next_action", "kiroNextAction", "next_action", "fix", "recommendation"], "");
  const files = stringifyList(record.files || record.file || record.path);
  return {
    behavior,
    failure: failure || bugList[0] || "Kane reported a verification failure.",
    bugs: bugList,
    evidence: evidenceList,
    why: why || "This behavior is part of the branch's acceptance criteria.",
    next: next || "Kiro should inspect the failing behavior, patch the branch, and rerun Kane.",
    files,
  };
}

function eventDetailFor(phase, fields, rawRecord) {
  const lines = [
    "Kane tested: " + fields.behavior,
  ];
  if (phase === "failed") {
    lines.push("Failure: " + fields.failure);
    if (fields.bugs.length) lines.push("Bug found: " + fields.bugs.join("; "));
    lines.push("Reason it matters: " + fields.why);
    lines.push("Kiro should fix next: " + fields.next);
  } else if (phase === "passed") {
    lines.push("Verified behavior: " + fields.behavior);
    lines.push("Evidence: " + (fields.evidence.length ? fields.evidence.join("; ") : "Kane returned a passing verification result."));
    lines.push("Merge readiness: the branch can move toward merge once the team accepts this evidence.");
  } else {
    lines.push("Verification started by Kane.");
  }
  lines.push("Raw Kane result: " + compactJson(rawRecord));
  return lines;
}

function eventForRecord(record, phase, index, parentId, defaults) {
  const fields = kaneFields(record, defaults);
  const timestamp = firstString(record, ["timestamp", "time", "at", "started_at", "completed_at"], new Date().toISOString());
  const reverify = Boolean(record.reverify || record.reverification || record.retry || record.retry_of || record.retryOf);
  const idSeed = firstString(record, ["id", "run_id", "runId", "check_id", "checkId"], stableId([defaults.inputFile, index, phase, compactJson(record)]));
  const label =
    phase === "started"
      ? "Verification started: " + fields.behavior
      : phase === "failed"
        ? "Verification failed: " + fields.behavior
        : reverify
          ? "Re-verification passed: " + fields.behavior
          : "Verification passed: " + fields.behavior;

  return {
    id: "kane_" + phase + "_" + stableId([idSeed, index, phase]),
    timestamp,
    source: "kane",
    type: phase === "started" ? "verify" : phase === "failed" ? "fail" : "pass",
    status: phase === "started" ? "verifying" : phase === "failed" ? "failed" : "passed",
    label,
    parentId,
    branchId: firstString(record, ["branch", "branchId"], defaults.branch),
    summary:
      phase === "failed"
        ? "Kane found a verification failure in " + fields.behavior + ". Kiro next action: " + fields.next
        : phase === "passed"
          ? "Kane verified " + fields.behavior + ". Evidence: " + (fields.evidence[0] || "passing result")
          : "Kane started verification for " + fields.behavior + ".",
    detail: eventDetailFor(phase, fields, record),
    files: fields.files.length ? fields.files : undefined,
    intent: defaults.feature,
    confidence: phase === "started" ? 0.68 : phase === "failed" ? 0.92 : 0.94,
    metadata: {
      adapter: "kane-result-adapter",
      featureKey: defaults.feature,
      featureTitle: defaults.featureTitle,
      kanePhase: phase,
      kaneBehavior: fields.behavior,
      kaneFailure: phase === "failed" ? fields.failure : undefined,
      kaneBugs: fields.bugs,
      kaneWhyItMatters: fields.why,
      kiroNextAction: phase === "failed" ? fields.next : undefined,
      kaneEvidence: fields.evidence,
      rawKaneResult: record.raw_result || record.raw_output || record,
    },
  };
}

function synthesizeBuildEvent(parentId, defaults, firstRecord) {
  const fields = kaneFields(firstRecord || {}, defaults);
  const id = "kiro_build_" + stableId([defaults.feature, defaults.branch, fields.behavior, defaults.inputFile]);
  return {
    id,
    timestamp: new Date().toISOString(),
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Kiro build: " + defaults.featureTitle,
    parentId,
    branchId: defaults.branch,
    summary: "Kiro changed " + defaults.featureTitle + " before handing the branch to Kane for verification.",
    detail: [
      "Feature: " + defaults.featureTitle,
      "Expected behavior: " + fields.behavior,
      "Kane result source: " + defaults.inputFile,
    ],
    files: fields.files.length ? fields.files : undefined,
    intent: defaults.feature,
    metadata: {
      adapter: "kane-result-adapter",
      featureKey: defaults.feature,
      featureTitle: defaults.featureTitle,
      changeSummary: "Kiro build ready for Kane verification.",
    },
  };
}

export function kaneResultsToOpenBranchEvents(records, options = {}) {
  const defaults = {
    inputFile: options.inputFile || "",
    branch: options.branch || "feature/kane-live-demo",
    feature: options.feature || "kane-live-demo",
    featureTitle: options.featureTitle || slugTitle(options.feature || "kane-live-demo"),
  };
  const events = [];
  let parentId = options.parent || null;

  if (options.synthesizeBuild && records.length) {
    const build = synthesizeBuildEvent(parentId, defaults, records[0]);
    events.push(build);
    parentId = build.id;
  }

  let sawStarted = false;
  records.forEach((record, index) => {
    const phase = normalizePhase(record);
    if ((phase === "failed" || phase === "passed") && !sawStarted) {
      const started = eventForRecord({ ...record, event: "verification_started" }, "started", index - 0.5, parentId, defaults);
      events.push(started);
      parentId = started.id;
      sawStarted = true;
    }

    const event = eventForRecord(record, phase, index, parentId, defaults);
    events.push(event);
    parentId = event.id;
    if (phase === "started") sawStarted = true;
  });

  return events;
}

export function ingestKaneResultFile(options) {
  if (!options.input) throw new Error("Missing --input");
  const inputFile = path.resolve(options.input);
  const eventsFile = path.resolve(options.eventsFile || "events.jsonl");
  const text = fs.readFileSync(inputFile, "utf8");
  const records = parseKaneResults(text, inputFile);
  if (!records.length) throw new Error("No Kane result records found in " + inputFile);

  ensureEventsFile(eventsFile);
  const parent = options.parent || readLastEventId(eventsFile);
  const events = kaneResultsToOpenBranchEvents(records, {
    ...options,
    inputFile,
    parent,
    featureTitle: options.featureTitle || slugTitle(options.feature),
  });

  fs.appendFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  return { eventsFile, inputFile, events };
}

async function watch(options) {
  const eventsFile = path.resolve(options.eventsFile || "events.jsonl");
  const inputFile = path.resolve(options.input);
  const seenRecords = new Set();
  let didSynthesizeBuild = false;
  const pollMs = Math.max(250, options.pollMs || 1000);
  const tick = () => {
    try {
      ensureEventsFile(eventsFile);
      const text = fs.readFileSync(inputFile, "utf8");
      const records = parseKaneResults(text, inputFile).filter((record) => {
        const key = stableId([inputFile, compactJson(record)]);
        if (seenRecords.has(key)) return false;
        seenRecords.add(key);
        return true;
      });
      if (!records.length) return;
      const events = kaneResultsToOpenBranchEvents(records, {
        ...options,
        inputFile,
        parent: readLastEventId(eventsFile),
        featureTitle: options.featureTitle || slugTitle(options.feature),
        synthesizeBuild: options.synthesizeBuild && !didSynthesizeBuild,
      });
      didSynthesizeBuild = didSynthesizeBuild || options.synthesizeBuild;
      fs.appendFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
      console.log("Ingested " + events.length + " Kane event(s) from " + inputFile);
    } catch (error) {
      console.error((error && error.message) || error);
    }
  };
  tick();
  setInterval(tick, pollMs);
}

async function watchSessions(options) {
  const eventsFile = path.resolve(options.eventsFile || "events.jsonl");
  const sessionsDir = path.resolve(options.sessionsDir || defaultKaneSessionsDir());
  const seenFiles = new Map();
  const pollMs = Math.max(500, options.pollMs || 1000);
  const tick = () => {
    try {
      ensureEventsFile(eventsFile);
      const files = kaneSessionResultFiles(sessionsDir).sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const candidate of files) {
        const previous = seenFiles.get(candidate.file);
        const signature = candidate.size + ":" + candidate.mtimeMs;
        if (previous === signature) continue;
        seenFiles.set(candidate.file, signature);
        const text = fs.readFileSync(candidate.file, "utf8");
        const records = parseKaneResults(text, candidate.file);
        if (!records.length) continue;
        const events = kaneResultsToOpenBranchEvents(records, {
          ...options,
          inputFile: candidate.file,
          parent: readLastEventId(eventsFile),
          featureTitle: options.featureTitle || slugTitle(options.feature),
          synthesizeBuild: false,
        });
        fs.appendFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
        console.log("Ingested " + events.length + " Kane Power session event(s) from " + candidate.file);
      }
    } catch (error) {
      console.error((error && error.message) || error);
    }
  };
  tick();
  setInterval(tick, pollMs);
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    if (options.watchSessions) {
      await watchSessions(options);
      return;
    }
    if (options.latestSession && !options.input) {
      const latest = kaneSessionResultFiles(options.sessionsDir || defaultKaneSessionsDir())[0];
      if (!latest) throw new Error("No Kane Power actions.ndjson files found in " + (options.sessionsDir || defaultKaneSessionsDir()));
      options.input = latest.file;
    }
    if (!options.input) throw new Error("Missing --input\n\n" + usage());
    if (options.watch) {
      await watch(options);
      return;
    }
    const result = ingestKaneResultFile(options);
    console.log("Ingested " + result.events.length + " Kane event(s) into " + result.eventsFile);
    for (const event of result.events) {
      console.log("- " + event.id + " " + event.label);
    }
  } catch (error) {
    console.error((error && error.message) || error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}

export function makeDemoId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + randomUUID().slice(0, 8);
}
