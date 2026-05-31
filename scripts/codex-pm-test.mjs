import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexRunLogEntry,
  loadCodexPmEnvFiles,
  runCodexPm,
  writeCodexRunLog,
} from "./codex-pm-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    tmpDir: path.join(rootDir, ".tmp"),
    goal: "Prove the Codex PM can generate a concise OpenBranch execution plan through the OpenAI API.",
    featureKey: "codex-pm-api-test",
    featureTitle: "Codex PM API Test",
    branch: "feature/codex-pm-api-test",
    behavior: "OpenBranch records a real Codex PM plan before Kiro and Kane run.",
    timeoutMs: 60_000,
    allowFallback: false,
    envFile: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for " + arg);
      i += 1;
      return next;
    };
    if (arg === "--tmp-dir") options.tmpDir = path.resolve(readValue());
    else if (arg === "--env-file") options.envFile = path.resolve(readValue());
    else if (arg === "--goal") options.goal = readValue();
    else if (arg === "--behavior") options.behavior = readValue();
    else if (arg === "--model") process.env.OPENBRANCH_PM_MODEL = readValue();
    else if (arg === "--timeout-ms") options.timeoutMs = Number(readValue()) || options.timeoutMs;
    else if (arg === "--allow-fallback") options.allowFallback = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("Unknown argument: " + arg);
  }
  return options;
}

function usage() {
  return [
    "Usage: npm run codex:test -- [--model <model>] [--allow-fallback]",
    "",
    "Calls the OpenAI Responses API with OPENAI_API_KEY and writes .tmp/codex-run.log.",
    "Loads .env.local, .env, OPENBRANCH_ENV_FILE, or --env-file when present.",
    "Without --allow-fallback, a missing API key or failed API request exits non-zero.",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const loadedEnv = loadCodexPmEnvFiles({ rootDir, envFile: options.envFile });
  const result = await runCodexPm(options, {
    mode: "test",
    timeoutMs: options.timeoutMs,
    capabilitySummary: [
      "This is a focused adapter smoke test; Kiro and Kane are not invoked.",
      loadedEnv.length ? "Loaded env files: " + loadedEnv.map((entry) => path.relative(rootDir, entry.file).replace(/\\/g, "/")).join(", ") : "No PM env file was loaded.",
    ].join("\n"),
  });
  result.envFilesLoaded = loadedEnv.map((entry) => ({
    file: path.relative(rootDir, entry.file).replace(/\\/g, "/"),
    keys: entry.keys,
  }));
  const logFile = path.join(options.tmpDir, "codex-run.log");
  writeCodexRunLog(logFile, codexRunLogEntry(result, "Codex PM API smoke test"));

  console.log("wrote " + path.relative(rootDir, logFile).replace(/\\/g, "/"));
  console.log("Codex PM API executed: " + (result.apiExecuted ? "yes" : "no"));
  console.log("Model: " + result.model);
  console.log("Plan: " + result.plan.developmentPlan[0]);

  if (!result.apiExecuted && !options.allowFallback) {
    console.error(result.error || "Codex PM API did not execute.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error((error && error.message) || error);
  process.exitCode = 1;
});
