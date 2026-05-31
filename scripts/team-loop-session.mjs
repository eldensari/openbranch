import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseKaneResults } from "./kane-result-adapter.mjs";

function userHome() {
  return process.env.USERPROFILE || process.env.HOME || "";
}

function toPosixPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function slugify(value) {
  return String(value || "team-loop")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54) || "team-loop";
}

function titleFromPrompt(prompt) {
  const clean = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!clean) return "AI Team Loop";
  return clean.length > 64 ? clean.slice(0, 61) + "..." : clean;
}

function shiftedIso(baseMs, offsetMs) {
  return new Date(baseMs + offsetMs).toISOString();
}

function ensureFiles(eventsFile, tmpDir, reset) {
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  if (reset || !fs.existsSync(eventsFile)) fs.writeFileSync(eventsFile, "");
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function appendEvents(eventsFile, events) {
  fs.appendFileSync(eventsFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
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
      candidates.push({
        sessionId: session.name,
        run: run.name,
        resultFile: fs.existsSync(actionsFile) ? actionsFile : summaryFile,
        actionsFile: fs.existsSync(actionsFile) ? actionsFile : "",
        summaryFile: fs.existsSync(summaryFile) ? summaryFile : "",
        mtimeMs: Math.max(...files.map((file) => fs.statSync(file).mtimeMs)),
      });
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0] || null;
}

function readKaneRecords(file) {
  const text = fs.readFileSync(file, "utf8");
  return parseKaneResults(text, file);
}

function fallbackKaneRecords(rootDir) {
  const failureFile = path.join(rootDir, "fixtures", "kane", "failure.ndjson");
  const passFile = path.join(rootDir, "fixtures", "kane", "pass.json");
  return {
    mode: "fixture",
    sourceFile: failureFile,
    passSourceFile: passFile,
    failureRecords: readKaneRecords(failureFile),
    passRecords: readKaneRecords(passFile),
  };
}

function latestRealKaneRecords(rootDir) {
  const latest = latestKanePowerResult();
  if (!latest?.resultFile) return fallbackKaneRecords(rootDir);
  return {
    mode: "kane_power",
    sourceFile: latest.resultFile,
    records: readKaneRecords(latest.resultFile),
    sessionId: latest.sessionId,
    run: latest.run,
  };
}

function recordOutcome(record) {
  const raw = String(record?.event || record?.status || "").toLowerCase();
  if (raw.includes("fail") || raw.includes("error")) return "failed";
  if (raw.includes("pass") || raw.includes("success") || raw.includes("complete")) return "passed";
  return "verifying";
}

function lastOutcomeRecord(records) {
  const reversed = [...(records || [])].reverse();
  return reversed.find((record) => ["failed", "passed"].includes(recordOutcome(record))) || reversed[0] || {};
}

function evidenceFromRecord(record) {
  return Array.isArray(record?.evidence)
    ? record.evidence.map((item) => String(item)).filter(Boolean).slice(0, 8)
    : [];
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
    branchId: overrides.branchId || context.branch,
    summary: overrides.summary,
    detail: overrides.detail,
    files: overrides.files,
    mergeParentIds: overrides.mergeParentIds,
    intent: context.featureKey,
    metadata: {
      controlTowerStep: true,
      teamLoopSessionId: context.sessionId,
      featureKey: context.featureKey,
      featureTitle: context.featureTitle,
      role: overrides.role,
      ...(overrides.metadata || {}),
    },
  };
}

function buildHandoffFiles(context, kaneMode, kaneSourceFile, outcomeRecord) {
  const prompt = context.prompt;
  const kanePath = "~/.testmuai/kaneai/sessions/<session-id>/runs/<run>/run-test/actions.ndjson";
  const outcome = recordOutcome(outcomeRecord);
  const failure = outcomeRecord?.failure || "No failure reported yet.";
  const next = outcome === "failed"
    ? outcomeRecord?.kiro_next_action || outcomeRecord?.kiroNextAction || "Repair the behavior Kane rejected, then rerun Kane verification."
    : "Kane verification is passing. Preserve the verified behavior and prepare the idea for acceptance.";

  return {
    "openbranch-goal.md": [
      "# OpenBranch AI Team Loop Goal",
      "",
      prompt,
      "",
      "## Roles",
      "",
      "- Codex = PM / goal keeper",
      "- Kiro = Builder",
      "- Kane = Verifier",
      "- OpenBranch = control tower + story layer",
      "",
      "## Session",
      "",
      "- Session ID: `" + context.sessionId + "`",
      "- Branch: `" + context.branch + "`",
      "- Feature: `" + context.featureTitle + "`",
    ].join("\n"),
    "codex-goal.md": [
      "/goal " + prompt,
      "",
      "Act as PM / goal keeper for this AI Team Loop.",
      "",
      "Coordinate Kiro's build task, Kane verification, and OpenBranch story recording.",
      "",
      "Generated files:",
      "- `.tmp/openbranch-goal.md`",
      "- `.tmp/codex-goal.md`",
      "- `.tmp/kiro-build-task.md`",
      "- `.tmp/kane-verification-task.md`",
      "- `.tmp/kiro-next-action.md`",
      "- `.tmp/kane-result.json`",
    ].join("\n"),
    "kiro-build-task.md": [
      "# Kiro Builder Task",
      "",
      "Run this as a three-round builder story:",
      "",
      "> " + prompt,
      "",
      "Round 1: implement the first attempt and expose the main assumption.",
      "Round 2: apply the correction from Kane's failure.",
      "Round 3: finalize the accepted behavior after Kane passes.",
    ].join("\n"),
    "kane-verification-task.md": [
      "# Kane Verification Task",
      "",
      "Verify the behavior requested by this prompt:",
      "",
      "> " + prompt,
      "",
      "Preferred real output:",
      "",
      "`" + kanePath + "`",
      "",
      "Current verification source: `" + kaneMode + "`" + (kaneSourceFile ? " from `" + toPosixPath(kaneSourceFile) + "`" : ""),
    ].join("\n"),
    "kiro-next-action.md": [
      "# Kiro Next Action",
      "",
      "OpenBranch generated a multi-round AI Team Loop story.",
      "",
      "## Next",
      "",
      outcome === "failed" ? next : "Carry the accepted lesson into the implementation and preserve the verified behavior.",
      "",
      "## Kane Source",
      "",
      kaneSourceFile ? toPosixPath(kaneSourceFile) : "Fallback fixture mode",
      "",
      "## Demo Story",
      "",
      "Kiro builds, Kane finds a problem, Codex reframes the goal, Kiro fixes, Kane re-verifies, and OpenBranch accepts the lesson.",
      "",
      "## Failure",
      "",
      outcome === "failed" ? failure : "Demo-safe synthesized failures are used to make the development story visible.",
    ].join("\n"),
  };
}

function writeHandoffFiles(tmpDir, files) {
  const written = [];
  for (const [filename, content] of Object.entries(files)) {
    const file = path.join(tmpDir, filename);
    writeFile(file, content);
    written.push(".tmp/" + filename);
  }
  return written;
}

function writeKaneResult(tmpDir, kaneData) {
  const resultFile = path.join(tmpDir, "kane-result.json");
  const payload = {
    source: kaneData.mode,
    sourceFile: kaneData.sourceFile,
    passSourceFile: kaneData.passSourceFile,
    results: kaneData.records || kaneData.failureRecords,
    passResults: kaneData.passRecords,
  };
  writeFile(resultFile, JSON.stringify(payload, null, 2));
  return ".tmp/kane-result.json";
}

function verificationModeForStory(kaneData) {
  return kaneData.mode === "kane_power"
    ? "demo_safe_synthesized_with_real_kane_reference"
    : "demo_safe_fixture";
}

function realKaneStoryContext(context, kaneData) {
  const records = kaneData.records || kaneData.failureRecords || [];
  const outcome = lastOutcomeRecord(records);
  const evidence = evidenceFromRecord(outcome);
  const realAvailable = kaneData.mode === "kane_power";
  return {
    realAvailable,
    mode: verificationModeForStory(kaneData),
    behavior: "Verify the Code Mode team story for: " + context.prompt,
    realBehavior: outcome?.behavior || "",
    realEvidence: evidence,
    sourceFile: kaneData.sourceFile ? toPosixPath(kaneData.sourceFile) : "",
    note: realAvailable
      ? "Real Kane Power output is available; OpenBranch synthesizes earlier demo-safe failure rounds so the hackathon story shows correction before the real pass."
      : "No real Kane Power output was found; OpenBranch uses demo-safe synthesized verification events.",
  };
}

function buildEvents(context, kaneData) {
  const kaneContext = realKaneStoryContext(context, kaneData);
  const experimentBranch = "experiment/first-attempt";
  const fixBranch = "fix/visibility-without-obstruction";
  const passBranch = "verification/pass";
  const finalEvidence = [
    "Code Mode is visible near the composer before submit.",
    "Story View shows failure, correction, pass, and accepted lesson.",
    "The active team-loop session is scoped so previous runs stay in Recents.",
  ];

  const session = createEvent(context, {
    key: "session",
    offsetMs: -250,
    source: "system",
    type: "session",
    status: "active",
    label: "AI Team Loop: " + context.featureTitle,
    branchId: "main",
    summary: "A fresh Code Mode session for: " + context.prompt,
    detail: [
      "Chat Mode is for discussion.",
      "Code Mode starts the Codex, Kiro, Kane, and OpenBranch team loop.",
    ],
    role: "OpenBranch",
  });
  const goal = createEvent(context, {
    key: "user_goal",
    offsetMs: 0,
    source: "user",
    type: "goal",
    status: "goal",
    label: "Goal: " + context.featureTitle,
    parentId: session.id,
    branchId: "main",
    summary: context.prompt,
    role: "user",
  });
  const r1Codex = createEvent(context, {
    key: "round1_codex_interprets_goal",
    offsetMs: 350,
    source: "codex",
    type: "plan",
    status: "planned",
    label: "Round 1: Codex PM interprets the goal",
    parentId: goal.id,
    branchId: "main",
    summary: "Codex turns the prompt into a visible success target for Kiro and Kane.",
    detail: [
      "User prompt: " + context.prompt,
      "Codex learned: the demo must show the team's work, not just a final pass.",
      "Success target: visible status, readable role ownership, and no obstructed story view.",
    ],
    role: "Codex PM",
  });
  const r1Kiro = createEvent(context, {
    key: "round1_kiro_first_attempt",
    offsetMs: 700,
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Round 1: Kiro first build",
    parentId: r1Codex.id,
    branchId: experimentBranch,
    summary: "Kiro implements the first version of the AI Team Loop status card.",
    detail: [
      "Kiro assumed: showing a compact status card after submit would be enough.",
      "Changed next: prompt submit creates the file bridge and graph events.",
      "Branch: " + experimentBranch,
    ],
    role: "Kiro Builder",
  });
  const r1Kane = createEvent(context, {
    key: "round1_kane_failure",
    offsetMs: 1050,
    source: "kane",
    type: "fail",
    status: "failed",
    label: "Round 1: Kane rejects visibility",
    parentId: r1Kiro.id,
    branchId: experimentBranch,
    summary: "Kane finds that the first attempt can be missed because the status card is not anchored to the Code Mode workflow.",
    detail: [
      "Kane rejected: progress appears after submit, but the entry point still looks like generic chat.",
      "Why it matters: judges may not realize one prompt starts the full team loop.",
      "Demo-safe synthesized verification: yes.",
      kaneContext.note,
    ],
    files: kaneContext.sourceFile ? [kaneContext.sourceFile] : undefined,
    metadata: {
      verificationMode: kaneContext.mode,
      demoSafeVerification: true,
      synthesizedVerification: true,
      kaneBehavior: "Confirm the Code Mode prompt clearly starts the AI Team Loop.",
      kaneFailure: "The first attempt does not make Code Mode feel like the primary path; users could still look for separate manual tools.",
      kaneWhyItMatters: "The demo needs a visible failure so judges understand how Kane turns uncertainty into the next build instruction.",
      kiroNextAction: "Move role ownership and Code Mode context closer to the composer, then re-check obstruction and readability.",
      kaneEvidence: [
        "Status card exists but does not explain what Kiro assumed.",
        "Manual controls remain visually competitive with the prompt.",
      ],
      kaneSourceFile: kaneContext.sourceFile,
    },
    role: "Kane Verifier",
  });
  const r2Codex = createEvent(context, {
    key: "round2_codex_reframes_failure",
    offsetMs: 1400,
    source: "codex",
    type: "plan",
    status: "planned",
    label: "Round 2: Codex reframes the failure",
    parentId: r1Kane.id,
    branchId: "main",
    summary: "Codex reframes the goal from 'show a card' to 'make the team loop impossible to miss.'",
    detail: [
      "Codex learned: visibility must start before submit, in the composer itself.",
      "New acceptance criteria: mode label, role legend, and manual tools demoted.",
      "Next attempt should remove obstruction, not just add more text.",
    ],
    role: "Codex PM",
  });
  const r2Kiro = createEvent(context, {
    key: "round2_kiro_fix",
    offsetMs: 1750,
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Round 2: Kiro applies visibility fix",
    parentId: r2Codex.id,
    branchId: fixBranch,
    summary: "Kiro moves Code Mode context and role ownership into the prompt area.",
    detail: [
      "What changed: composer gets Code Mode context and role legend.",
      "What changed: manual tools are grouped under debugging controls.",
      "Branch: " + fixBranch,
    ],
    role: "Kiro Builder",
  });
  const r2Kane = createEvent(context, {
    key: "round2_kane_partial",
    offsetMs: 2100,
    source: "kane",
    type: "fail",
    status: "failed",
    label: "Round 2: Kane finds partial pass",
    parentId: r2Kiro.id,
    branchId: fixBranch,
    summary: "Kane sees the loop is clearer, but flags that the progress story still needs an explicit accepted lesson.",
    detail: [
      "Kane accepted: Code Mode is now visible near the composer.",
      "Kane rejected: the story still needs to explain why the final pass is trustworthy.",
      "Demo-safe synthesized verification: yes.",
      kaneContext.note,
    ],
    files: kaneContext.sourceFile ? [kaneContext.sourceFile] : undefined,
    metadata: {
      verificationMode: kaneContext.mode,
      demoSafeVerification: true,
      synthesizedVerification: true,
      kaneBehavior: "Confirm the fix makes the team loop understandable before and after submit.",
      kaneFailure: "Partial pass: the entry point is clear, but the accepted lesson is not explicit enough.",
      kaneWhyItMatters: "The final merge should carry forward what the team learned, not just say the check passed.",
      kiroNextAction: "Add final acceptance criteria and make the pass explain why Kane trusted the corrected loop.",
      kaneEvidence: [
        "Mode label and role legend are present.",
        "The story still needs an accepted lesson node.",
      ],
      kaneSourceFile: kaneContext.sourceFile,
    },
    role: "Kane Verifier",
  });
  const r3Codex = createEvent(context, {
    key: "round3_codex_narrows_goal",
    offsetMs: 2450,
    source: "codex",
    type: "plan",
    status: "planned",
    label: "Round 3: Codex narrows acceptance",
    parentId: r2Kane.id,
    branchId: "main",
    summary: "Codex narrows the goal to a judge-readable sequence: prompt, failure, fix, pass, accepted lesson.",
    detail: [
      "Codex learned: the useful artifact is the development story itself.",
      "Final acceptance: the graph must show what failed, what changed, and why Kane passed.",
    ],
    role: "Codex PM",
  });
  const r3Kiro = createEvent(context, {
    key: "round3_kiro_finalizes",
    offsetMs: 2800,
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Round 3: Kiro finalizes the story",
    parentId: r3Codex.id,
    branchId: passBranch,
    summary: "Kiro finalizes the Code Mode story and preserves the accepted lesson.",
    detail: [
      "What changed: final pass explains the corrected behavior.",
      "What changed: OpenBranch can merge the verified lesson back to main.",
      "Branch: " + passBranch,
    ],
    role: "Kiro Builder",
  });
  const r3Kane = createEvent(context, {
    key: "round3_kane_pass",
    offsetMs: 3150,
    source: "kane",
    type: "pass",
    status: "passed",
    label: "Round 3: Kane passes",
    parentId: r3Kiro.id,
    branchId: passBranch,
    summary: "Kane passes after the prompt path, role ownership, and accepted lesson are all visible.",
    detail: [
      "Why Kane passed: the user can see Code Mode, the team roles, the failure correction, and the accepted lesson.",
      "Verification source: " + (kaneContext.sourceFile || "demo-safe synthesized verification"),
      ...finalEvidence.map((item) => "Evidence: " + item),
    ],
    files: kaneContext.sourceFile ? [kaneContext.sourceFile] : undefined,
    metadata: {
      verificationMode: kaneContext.mode,
      demoSafeVerification: true,
      synthesizedVerification: true,
      kaneBehavior: kaneContext.behavior,
      kaneEvidence: finalEvidence,
      realKaneBehavior: kaneContext.realBehavior,
      realKaneEvidence: kaneContext.realEvidence,
      kaneSourceFile: kaneContext.sourceFile,
    },
    role: "Kane Verifier",
  });
  const accepted = createEvent(context, {
    key: "accepted_lesson",
    offsetMs: 3500,
    source: "merge",
    type: "merge",
    status: "merged",
    label: "Accepted lesson: " + context.featureTitle,
    parentId: goal.id,
    branchId: "main",
    mergeParentIds: [r3Kane.id, r2Kane.id],
    summary: "OpenBranch accepts the lesson: the AI team's work is now visible as a development story.",
    detail: [
      "Accepted lesson: a one-prompt Code Mode flow is clearer when the graph shows tension, repair, verification, and merge.",
      "Git shows what changed in code. OpenBranch shows how the AI team reached trust.",
    ],
    role: "OpenBranch",
  });

  return [session, goal, r1Codex, r1Kiro, r1Kane, r2Codex, r2Kiro, r2Kane, r3Codex, r3Kiro, r3Kane, accepted];
}

export function startTeamLoopSession(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const tmpDir = options.tmpDir || path.join(rootDir, ".tmp");
  const eventsFile = options.eventsFile || path.join(rootDir, "events.jsonl");
  const prompt = String(options.prompt || "").trim();
  if (!prompt) throw new Error("Missing prompt for OpenBranch team loop.");

  const sessionId = "team_" + Date.now().toString(36) + "_" + randomUUID().slice(0, 8);
  const featureKey = slugify(prompt);
  const context = {
    sessionId,
    prompt,
    featureKey,
    featureTitle: titleFromPrompt(prompt),
    branch: "feature/" + featureKey,
    baseMs: Date.now(),
  };

  ensureFiles(eventsFile, tmpDir, options.reset === true);

  const kaneData = latestRealKaneRecords(rootDir);
  const outcome = lastOutcomeRecord(kaneData.mode === "fixture" ? kaneData.failureRecords : kaneData.records);
  const handoffFiles = buildHandoffFiles(context, kaneData.mode, kaneData.sourceFile, outcome);
  const generatedFiles = writeHandoffFiles(tmpDir, handoffFiles);
  generatedFiles.push(writeKaneResult(tmpDir, kaneData));
  writeFile(path.join(tmpDir, "integration-surfaces.json"), JSON.stringify([
    { name: "codex", available: true, mode: "file_bridge", notes: "Prompt submit generated `.tmp/codex-goal.md`." },
    { name: "kiro", available: true, mode: "file_bridge", notes: "Prompt submit generated `.tmp/kiro-build-task.md`." },
    {
      name: "kane",
      available: true,
      mode: kaneData.mode,
      command: kaneData.sourceFile || "fixtures/kane/failure.ndjson",
      notes: kaneData.mode === "kane_power"
        ? "Using latest Kane Power session output."
        : "No real Kane Power output found; using fixtures for demo safety.",
    },
    { name: "file_bridge", available: true, mode: "file_bridge", notes: "OpenBranch wrote local `.tmp` handoff files and appended `events.jsonl`." },
  ], null, 2));
  generatedFiles.push(".tmp/integration-surfaces.json");

  const events = buildEvents(context, kaneData);
  appendEvents(eventsFile, events);

  return {
    ok: true,
    sessionId,
    title: context.prompt,
    mode: kaneData.mode,
    verificationMode: verificationModeForStory(kaneData),
    sourceFile: kaneData.sourceFile || "",
    generatedFiles,
    events,
    eventsText: fs.readFileSync(eventsFile, "utf8"),
  };
}
