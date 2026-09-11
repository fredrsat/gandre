import Database from 'better-sqlite3';
import path from 'node:path';
import { dbPath, agentsDir, ensureDirs } from './config.js';
import type { Agent, McpServer, Run, RunTrigger } from './types.js';

ensureDirs();

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  schedule_cron TEXT,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  api_key       TEXT,
  base_url      TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  task_prompt   TEXT NOT NULL,
  workdir       TEXT NOT NULL,
  allow_write   INTEGER NOT NULL DEFAULT 0,
  mcp_server_ids TEXT NOT NULL DEFAULT '[]',
  max_steps     INTEGER NOT NULL DEFAULT 25,
  ntfy_url      TEXT,
  ntfy_topic    TEXT,
  ntfy_token    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  config       TEXT NOT NULL,
  last_status  TEXT,
  last_checked TEXT,
  last_tools   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL REFERENCES agents(id),
  trigger         TEXT NOT NULL,
  status          TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  finished_at     TEXT,
  final_text      TEXT,
  error           TEXT,
  transcript_json TEXT,
  usage_json      TEXT,
  step_count      INTEGER
);
CREATE INDEX IF NOT EXISTS runs_agent_started ON runs(agent_id, started_at DESC);
`);

const now = () => new Date().toISOString();

migrate();

// v1 → v2: per-agent overstyringer + MCP-register (inline mcp_servers-JSON flyttes til registeret)
function migrate(): void {
  const cols = (db.pragma('table_info(agents)') as { name: string }[]).map((c) => c.name);
  if (!cols.includes('mcp_servers')) return; // allerede v2

  for (const col of ['api_key', 'base_url', 'mcp_server_ids', 'ntfy_url', 'ntfy_topic', 'ntfy_token']) {
    if (!cols.includes(col)) {
      const def = col === 'mcp_server_ids' ? "TEXT NOT NULL DEFAULT '[]'" : 'TEXT';
      db.exec(`ALTER TABLE agents ADD COLUMN ${col} ${def}`);
    }
  }

  const agents = db.prepare('SELECT id, mcp_servers FROM agents').all() as { id: string; mcp_servers: string }[];
  const byName = db.prepare('SELECT id FROM mcp_servers WHERE name = ?');
  for (const a of agents) {
    let inline: ({ name?: string } & Record<string, unknown>)[] = [];
    try { inline = JSON.parse(a.mcp_servers || '[]'); } catch { /* ugyldig gammel JSON — hopp over */ }
    const ids: string[] = [];
    for (const entry of inline) {
      const { name, ...config } = entry;
      const serverName = String(name ?? 'uten-navn');
      const existing = byName.get(serverName) as { id: string } | undefined;
      if (existing) {
        ids.push(existing.id);
      } else {
        const id = crypto.randomUUID();
        db.prepare(
          'INSERT INTO mcp_servers (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(id, serverName, JSON.stringify(config), now(), now());
        ids.push(id);
      }
    }
    db.prepare('UPDATE agents SET mcp_server_ids = ? WHERE id = ?').run(JSON.stringify(ids), a.id);
  }
  db.exec('ALTER TABLE agents DROP COLUMN mcp_servers');
  console.log(`[db] migrerte ${agents.length} agent(er) til MCP-register`);
}

export interface AgentInput {
  name: string;
  enabled: boolean;
  schedule_cron: string | null;
  provider: string;
  model: string;
  api_key: string | null;
  base_url: string | null;
  system_prompt: string;
  task_prompt: string;
  workdir: string | null;
  allow_write: boolean;
  mcp_server_ids: string[];
  max_steps: number;
  ntfy_url: string | null;
  ntfy_topic: string | null;
  ntfy_token: string | null;
}

export function listAgents(): Agent[] {
  return db.prepare('SELECT * FROM agents ORDER BY name').all() as Agent[];
}

export function getAgent(id: string): Agent | undefined {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
}

export function createAgent(input: AgentInput): Agent {
  const id = crypto.randomUUID();
  const workdir = input.workdir || path.join(agentsDir, id);
  db.prepare(
    `INSERT INTO agents (id, name, enabled, schedule_cron, provider, model, api_key, base_url,
       system_prompt, task_prompt, workdir, allow_write, mcp_server_ids, max_steps,
       ntfy_url, ntfy_topic, ntfy_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, input.name, input.enabled ? 1 : 0, input.schedule_cron, input.provider, input.model,
    input.api_key, input.base_url, input.system_prompt, input.task_prompt, workdir,
    input.allow_write ? 1 : 0, JSON.stringify(input.mcp_server_ids), input.max_steps,
    input.ntfy_url, input.ntfy_topic, input.ntfy_token, now(), now()
  );
  return getAgent(id)!;
}

export function updateAgent(id: string, input: AgentInput): void {
  db.prepare(
    `UPDATE agents SET name=?, enabled=?, schedule_cron=?, provider=?, model=?, api_key=?, base_url=?,
       system_prompt=?, task_prompt=?, workdir=?, allow_write=?, mcp_server_ids=?, max_steps=?,
       ntfy_url=?, ntfy_topic=?, ntfy_token=?, updated_at=?
     WHERE id=?`
  ).run(
    input.name, input.enabled ? 1 : 0, input.schedule_cron, input.provider, input.model,
    input.api_key, input.base_url, input.system_prompt, input.task_prompt,
    input.workdir || path.join(agentsDir, id), input.allow_write ? 1 : 0,
    JSON.stringify(input.mcp_server_ids), input.max_steps,
    input.ntfy_url, input.ntfy_topic, input.ntfy_token, now(), id
  );
}

export function deleteAgent(id: string): void {
  db.prepare('DELETE FROM runs WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

export function agentMcpServerIds(agent: Agent): string[] {
  try { return JSON.parse(agent.mcp_server_ids || '[]'); } catch { return []; }
}

// --- MCP-register ---

export function listMcpServers(): McpServer[] {
  return db.prepare('SELECT * FROM mcp_servers ORDER BY name').all() as McpServer[];
}

export function getMcpServer(id: string): McpServer | undefined {
  return db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServer | undefined;
}

export function createMcpServer(name: string, config: string): McpServer {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO mcp_servers (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, config, now(), now());
  return getMcpServer(id)!;
}

export function updateMcpServer(id: string, name: string, config: string): void {
  db.prepare(
    `UPDATE mcp_servers SET name=?, config=?, last_status=NULL, last_checked=NULL, last_tools=NULL,
     updated_at=? WHERE id=?`
  ).run(name, config, now(), id);
}

export function deleteMcpServer(id: string): void {
  // Fjern referansen fra alle agenter som bruker serveren
  for (const agent of listAgents()) {
    const ids = agentMcpServerIds(agent);
    if (ids.includes(id)) {
      db.prepare('UPDATE agents SET mcp_server_ids = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(ids.filter((x) => x !== id)), now(), agent.id);
    }
  }
  db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
}

export function setMcpServerStatus(id: string, status: string, tools: string[] | null): void {
  db.prepare('UPDATE mcp_servers SET last_status=?, last_checked=?, last_tools=? WHERE id=?')
    .run(status, now(), tools ? JSON.stringify(tools) : null, id);
}

export function agentsUsingMcpServer(serverId: string): Agent[] {
  return listAgents().filter((a) => agentMcpServerIds(a).includes(serverId));
}

// --- Kjøringer ---

export function insertRun(agentId: string, trigger: RunTrigger): number {
  const res = db.prepare(
    `INSERT INTO runs (agent_id, trigger, status, started_at) VALUES (?, ?, 'running', ?)`
  ).run(agentId, trigger, now());
  return Number(res.lastInsertRowid);
}

export function finishRun(
  id: number,
  fields: { status: string; final_text?: string; error?: string; transcript_json?: string; usage_json?: string; step_count?: number }
): void {
  db.prepare(
    `UPDATE runs SET status=?, finished_at=?, final_text=?, error=?, transcript_json=?, usage_json=?, step_count=? WHERE id=?`
  ).run(
    fields.status, now(), fields.final_text ?? null, fields.error ?? null,
    fields.transcript_json ?? null, fields.usage_json ?? null, fields.step_count ?? null, id
  );
}

export function getRun(id: number): Run | undefined {
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run | undefined;
}

export function listRuns(agentId: string | null, limit: number, offset: number): Run[] {
  if (agentId) {
    return db.prepare(
      'SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?'
    ).all(agentId, limit, offset) as Run[];
  }
  return db.prepare(
    'SELECT * FROM runs ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as Run[];
}

export function lastRun(agentId: string): Run | undefined {
  return db.prepare(
    'SELECT * FROM runs WHERE agent_id = ? ORDER BY started_at DESC, id DESC LIMIT 1'
  ).get(agentId) as Run | undefined;
}

export interface AgentStats {
  runs: number;
  success: number;
  error: number;
  inputTokens: number;
  outputTokens: number;
}

export function agentStats(agentId: string, sinceIso?: string): AgentStats {
  const row = db.prepare(
    `SELECT
       COUNT(*) AS runs,
       SUM(status = 'success') AS success,
       SUM(status = 'error') AS error,
       COALESCE(SUM(json_extract(usage_json, '$.inputTokens')), 0) AS inputTokens,
       COALESCE(SUM(json_extract(usage_json, '$.outputTokens')), 0) AS outputTokens
     FROM runs WHERE agent_id = ? AND started_at >= ?`
  ).get(agentId, sinceIso ?? '') as AgentStats;
  return {
    runs: row.runs ?? 0,
    success: row.success ?? 0,
    error: row.error ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
  };
}

export function markInterruptedRuns(): void {
  db.prepare(`UPDATE runs SET status='interrupted', finished_at=? WHERE status='running'`).run(now());
}

export function pruneOldRuns(days = 90): void {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  db.prepare(`DELETE FROM runs WHERE started_at < ? AND status != 'running'`).run(cutoff);
}
