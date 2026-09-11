import { z } from 'zod';

export type Provider = 'anthropic' | 'openrouter' | 'ollama';

// Transport-konfigurasjonen til en MCP-server (navnet ligger som egen kolonne i registeret)
export const mcpConfigSchema = z.union([
  z.object({
    transport: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    transport: z.enum(['http', 'sse']),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);

export type McpConfig = z.infer<typeof mcpConfigSchema>;

export interface McpServer {
  id: string;
  name: string;
  config: string; // JSON: McpConfig
  last_status: string | null;   // 'ok' | 'error: …' | null = aldri testet
  last_checked: string | null;
  last_tools: string | null;    // JSON: string[] med verktøynavn fra siste test
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  enabled: number;
  schedule_cron: string | null;
  provider: Provider;
  model: string;
  api_key: string | null;    // overstyrer .env for denne agenten
  base_url: string | null;   // overstyrer OLLAMA_BASE_URL (kun ollama)
  system_prompt: string;
  task_prompt: string;
  workdir: string;
  allow_write: number;
  mcp_server_ids: string;    // JSON: string[] med id-er fra mcp_servers
  max_steps: number;
  ntfy_url: string | null;   // overstyrer NTFY_URL
  ntfy_topic: string | null; // overstyrer NTFY_TOPIC
  ntfy_token: string | null; // overstyrer NTFY_TOKEN
  created_at: string;
  updated_at: string;
}

export type RunStatus = 'running' | 'success' | 'error' | 'interrupted';
export type RunTrigger = 'schedule' | 'manual';

export interface Run {
  id: number;
  agent_id: string;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  final_text: string | null;
  error: string | null;
  transcript_json: string | null;
  usage_json: string | null;
  step_count: number | null;
}
