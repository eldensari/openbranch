import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestKaneResultFile, makeDemoId } from "./kane-result-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    eventsFile: path.join(rootDir, "events.jsonl"),
    delayMs: 1200,
    reset: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for " + arg);
      i += 1;
      return next;
    };

    if (arg === "--events-file") {
      options.eventsFile = path.resolve(readValue());
    } else if (arg === "--delay") {
      options.delayMs = Number(readValue()) || options.delayMs;
    } else if (arg === "--reset") {
      options.reset = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error("Unknown argument: " + arg);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/demo-kane-loop.mjs --reset [--delay 1200]",
    "",
    "Appends a live Kiro -> Kane fail -> Kiro fix -> Kane pass loop to events.jsonl.",
    "Open OpenBranch, click Live Development Events, then run this script in another terminal.",
  ].join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
}

function appendEvent(eventsFile, event) {
  event.timestamp = new Date().toISOString();
  fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n");
  console.log("+ " + event.id + " " + event.label);
  return event;
}

async function appendStep(eventsFile, delayMs, event) {
  appendEvent(eventsFile, event);
  await sleep(delayMs);
  return event;
}

function demoEvents(now) {
  const goal = {
    id: makeDemoId("demo_goal"),
    timestamp: new Date(now).toISOString(),
    source: "user",
    type: "goal",
    status: "goal",
    label: "Goal: Close the Kiro/Kane loop",
    parentId: null,
    branchId: "main",
    summary: "Show a real Kane verification result entering OpenBranch and guiding the next Kiro action.",
    intent: "kane-live-demo",
    metadata: { featureKey: "kane-live-demo", featureTitle: "Kane Live Demo" },
  };
  const plan = {
    id: makeDemoId("demo_plan"),
    timestamp: new Date(now + 500).toISOString(),
    source: "kiro",
    type: "plan",
    status: "planned",
    label: "Kiro plan: instrument demo button",
    parentId: goal.id,
    branchId: "main",
    summary: "Kiro plans a minimal feature change, then hands the branch to Kane for verification.",
    intent: "kane-live-demo",
    metadata: { featureKey: "kane-live-demo", featureTitle: "Kane Live Demo" },
  };
  const build = {
    id: makeDemoId("demo_build"),
    timestamp: new Date(now + 1000).toISOString(),
    source: "kiro",
    type: "build_attempt",
    status: "building",
    label: "Kiro build: live demo verification",
    parentId: plan.id,
    branchId: "feature/kane-live-demo",
    summary: "Kiro changes the demo flow so Kane can verify whether Story View explains the verification loop.",
    detail: [
      "Changed behavior: Run AI Development Demo should show live verification feedback.",
      "Hand-off: Kane should verify the selected node explains the failure and next Kiro action.",
    ],
    files: ["src/App.tsx", "src/lib/common-events.ts"],
    intent: "kane-live-demo",
    metadata: {
      featureKey: "kane-live-demo",
      featureTitle: "Kane Live Demo",
      changeSummary: "Kiro build ready for Kane verification.",
    },
  };
  const fixBranch = {
    id: makeDemoId("demo_fix_branch"),
    timestamp: new Date(now + 9000).toISOString(),
    source: "agent",
    type: "fix_branch",
    status: "branching",
    label: "AI fix branch: carry Kane guidance into Story View",
    parentId: null,
    branchId: "fix/kane-live-demo",
    summary: "The failed Kane result opens a retry branch so Kiro can patch the missing guidance.",
    detail: [
      "Kiro uses Kane's next action to update the branch episode.",
      "The retry should preserve the original failed evidence instead of hiding it.",
    ],
    files: ["src/lib/common-events.ts"],
    intent: "kane-live-demo",
    metadata: {
      featureKey: "kane-live-demo",
      featureTitle: "Kane Live Demo",
      changeSummary: "Kiro applies Kane's fix guidance before re-verification.",
    },
  };
  return { goal, plan, build, fixBranch };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  ensureFile(options.eventsFile);
  if (options.reset) fs.writeFileSync(options.eventsFile, "");

  const fixturesDir = path.join(rootDir, "fixtures", "kane");
  const failureFixture = path.join(fixturesDir, "failure.ndjson");
  const passFixture = path.join(fixturesDir, "pass.json");
  const { goal, plan, build, fixBranch } = demoEvents(Date.now());

  console.log("Writing demo events to " + options.eventsFile);
  await appendStep(options.eventsFile, options.delayMs, goal);
  await appendStep(options.eventsFile, options.delayMs, plan);
  await appendStep(options.eventsFile, options.delayMs, build);

  const failure = ingestKaneResultFile({
    input: failureFixture,
    eventsFile: options.eventsFile,
    branch: "feature/kane-live-demo",
    feature: "kane-live-demo",
    featureTitle: "Kane Live Demo",
    parent: build.id,
  });
  for (const event of failure.events) console.log("+ " + event.id + " " + event.label);
  const failureEvent = failure.events[failure.events.length - 1];
  await sleep(options.delayMs);

  fixBranch.parentId = failureEvent?.id || build.id;
  await appendStep(options.eventsFile, options.delayMs, fixBranch);

  const pass = ingestKaneResultFile({
    input: passFixture,
    eventsFile: options.eventsFile,
    branch: "fix/kane-live-demo",
    feature: "kane-live-demo",
    featureTitle: "Kane Live Demo",
    parent: fixBranch.id,
  });
  for (const event of pass.events) console.log("+ " + event.id + " " + event.label);

  console.log("Demo complete. OpenBranch Live Development Events should show the Kane loop closing.");
}

main().catch((error) => {
  console.error((error && error.message) || error);
  process.exitCode = 1;
});
