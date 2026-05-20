/* Neo4j Aura save for AI Team Validation sessions.
 *
 * Reads credentials from (in order): VITE_NEO4J_* env vars at build time,
 * then localStorage keys `neo4j:uri`, `neo4j:user`, `neo4j:pass`.
 *
 * Save is fire-and-forget — failures never block the demo flow.
 */

import neo4j, { type Driver } from "neo4j-driver";

export type Neo4jConfig = {
  uri: string;
  username: string;
  password: string;
};

export type AgentRunRecord = {
  id: string;
  role: "master" | "executor" | "validator" | "critic";
  provider: string;
  model: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  content: string;
  verdict?: string | null;
  iteration?: number;
  executorPhase?: "draft" | "review" | "task";
  refinesId?: string | null;
  /** If set, this run is also a :SynthesisMerge — multi-parent merge of these AgentRun ids */
  mergesIds?: string[];
  round?: number;
};

export type SessionRecord = {
  id: string;
  user_prompt: string;
  started_at: number;
  completed_at: number;
  total_duration_ms: number;
  final_verdict: "approved" | "rejected" | "warning" | null;
  runs: AgentRunRecord[];
};

function readConfig(): Neo4jConfig | null {
  const fromEnv = {
    uri: (import.meta.env.VITE_NEO4J_URI as string | undefined) || "",
    username: (import.meta.env.VITE_NEO4J_USERNAME as string | undefined) || "",
    password: (import.meta.env.VITE_NEO4J_PASSWORD as string | undefined) || "",
  };
  if (fromEnv.uri && fromEnv.username && fromEnv.password) return fromEnv;

  try {
    const uri = localStorage.getItem("neo4j:uri") || "";
    const username = localStorage.getItem("neo4j:user") || "";
    const password = localStorage.getItem("neo4j:pass") || "";
    if (uri && username && password) return { uri, username, password };
  } catch {
    /* localStorage may be unavailable */
  }
  return null;
}

export function neo4jConfigured(): boolean {
  return readConfig() !== null;
}

let cachedDriver: Driver | null = null;
let cachedConfigKey = "";

function getDriver(cfg: Neo4jConfig): Driver {
  const key = cfg.uri + "|" + cfg.username;
  if (cachedDriver && cachedConfigKey === key) return cachedDriver;
  if (cachedDriver) {
    try {
      cachedDriver.close();
    } catch {
      /* ignore */
    }
  }
  cachedDriver = neo4j.driver(cfg.uri, neo4j.auth.basic(cfg.username, cfg.password), {
    userAgent: "openbranch-team-validation/1.0",
  });
  cachedConfigKey = key;
  return cachedDriver;
}

const SAVE_QUERY = `
MERGE (s:Session { id: $session_id })
SET s.user_prompt      = $user_prompt,
    s.started_at       = datetime({ epochMillis: $started_at }),
    s.completed_at     = datetime({ epochMillis: $completed_at }),
    s.total_duration_ms = $total_duration_ms,
    s.final_verdict    = $final_verdict
WITH s
UNWIND $runs AS run
MERGE (r:AgentRun { id: run.id })
SET r.role           = run.role,
    r.provider       = run.provider,
    r.model          = run.model,
    r.started_at     = datetime({ epochMillis: run.startedAt }),
    r.completed_at   = datetime({ epochMillis: run.completedAt }),
    r.duration_ms    = run.durationMs,
    r.content        = run.content,
    r.verdict        = run.verdict,
    r.iteration      = run.iteration,
    r.executor_phase = run.executorPhase
MERGE (s)-[:CONTAINS]->(r)
WITH s, r, run
FOREACH (_ IN CASE WHEN run.refinesId IS NOT NULL THEN [1] ELSE [] END |
  MERGE (parent:AgentRun { id: run.refinesId })
  MERGE (r)-[:REFINES]->(parent)
)
FOREACH (_ IN CASE WHEN run.mergesIds IS NOT NULL AND size(run.mergesIds) > 0 THEN [1] ELSE [] END |
  SET r:SynthesisMerge,
      r.round = run.round,
      r.merge_size = size(run.mergesIds)
)
WITH s, r, run
UNWIND coalesce(run.mergesIds, []) AS mergedId
MERGE (mergedRun:AgentRun { id: mergedId })
MERGE (r)-[:MERGES]->(mergedRun)
WITH s, r, run
WITH s
OPTIONAL MATCH (s)-[:CONTAINS]->(mast:AgentRun { role: 'master', iteration: 1 })
WITH s, mast
OPTIONAL MATCH (s)-[:CONTAINS]->(exec:AgentRun { role: 'executor', iteration: 1 })
WITH s, mast, exec
OPTIONAL MATCH (s)-[:CONTAINS]->(val:AgentRun { role: 'validator', iteration: 1 })
WITH s, mast, exec, val
OPTIONAL MATCH (s)-[:CONTAINS]->(crit:AgentRun { role: 'critic', iteration: 1 })
WITH s, mast, exec, val, crit
FOREACH (_ IN CASE WHEN mast IS NOT NULL THEN [1] ELSE [] END |
  SET s.master_id = mast.id
)
FOREACH (_ IN CASE WHEN exec IS NOT NULL THEN [1] ELSE [] END |
  MERGE (exec)-[:WROTE_FOR]->(s)
)
FOREACH (_ IN CASE WHEN val IS NOT NULL AND exec IS NOT NULL THEN [1] ELSE [] END |
  MERGE (val)-[:VERIFIED]->(exec)
)
FOREACH (_ IN CASE WHEN crit IS NOT NULL AND exec IS NOT NULL THEN [1] ELSE [] END |
  MERGE (crit)-[:CRITIQUED]->(exec)
)
FOREACH (_ IN CASE WHEN mast IS NOT NULL AND val IS NOT NULL THEN [1] ELSE [] END |
  MERGE (mast)-[:SYNTHESIZED]->(val)
)
FOREACH (_ IN CASE WHEN mast IS NOT NULL AND crit IS NOT NULL THEN [1] ELSE [] END |
  MERGE (mast)-[:SYNTHESIZED]->(crit)
)
RETURN s.id AS id
`;

export async function saveSessionToNeo4j(
  session: SessionRecord,
): Promise<{ ok: boolean; error?: string }> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: "Neo4j not configured" };

  let sess: ReturnType<Driver["session"]> | null = null;
  try {
    const driver = getDriver(cfg);
    sess = driver.session();
    await sess.executeWrite((tx) =>
      tx.run(SAVE_QUERY, {
        session_id: session.id,
        user_prompt: session.user_prompt,
        started_at: session.started_at,
        completed_at: session.completed_at,
        total_duration_ms: session.total_duration_ms,
        final_verdict: session.final_verdict,
        runs: session.runs,
      }),
    );
    return { ok: true };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.warn("[neo4j] save failed:", msg);
    return { ok: false, error: msg };
  } finally {
    try {
      await sess?.close();
    } catch {
      /* ignore */
    }
  }
}

export function neo4jBrowserUrl(): string | null {
  const cfg = readConfig();
  if (!cfg?.uri) return null;
  // neo4j+s://abc123.databases.neo4j.io -> https://browser.neo4j.io/?dbms=neo4j+s%3A%2F%2Fabc123...
  return "https://browser.neo4j.io/?dbms=" + encodeURIComponent(cfg.uri);
}
