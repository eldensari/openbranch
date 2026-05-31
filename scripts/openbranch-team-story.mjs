import path from "node:path";
import { fileURLToPath } from "node:url";
import { startTeamLoopSession } from "./team-loop-session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function usage() {
  return [
    'Usage: npm run openbranch:team-story -- "Improve the AI Team Loop status card visibility"',
    "",
    "Creates a deterministic three-round Code Mode team story:",
    "- initial Kiro assumption",
    "- Kane failure",
    "- Codex reframing",
    "- Kiro correction",
    "- Kane pass",
    "- accepted lesson",
  ].join("\n");
}

const prompt = process.argv.slice(2).join(" ").trim();

if (!prompt || prompt === "--help" || prompt === "-h") {
  console.log(usage());
  process.exitCode = prompt ? 0 : 1;
} else {
  const result = startTeamLoopSession({
    rootDir,
    eventsFile: path.join(rootDir, "events.jsonl"),
    tmpDir: path.join(rootDir, ".tmp"),
    prompt,
    reset: false,
  });

  console.log("Created OpenBranch AI Team Loop story");
  console.log("Session: " + result.sessionId);
  console.log("Title: " + result.title);
  console.log("Verification: " + result.verificationMode);
  if (result.sourceFile) console.log("Kane source: " + result.sourceFile);
  console.log("");
  for (const event of result.events) {
    console.log("- " + event.label);
  }
}
