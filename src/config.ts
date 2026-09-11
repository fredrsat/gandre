import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(import.meta.dirname, '..');

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || fallback;
}

export const config = {
  root,
  dataDir: path.resolve(root, env('GANDRE_DATA_DIR', './data')!),
  port: Number(env('GANDRE_PORT', '3040')),
  bind: env('GANDRE_BIND', '0.0.0.0')!,
  publicUrl: env('GANDRE_PUBLIC_URL', `http://localhost:${env('GANDRE_PORT', '3040')}`)!,
  anthropicApiKey: env('ANTHROPIC_API_KEY'),
  openrouterApiKey: env('OPENROUTER_API_KEY'),
  ollamaBaseUrl: env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/api')!,
  ntfyUrl: env('NTFY_URL', 'https://ntfy.sh')!,
  ntfyTopic: env('NTFY_TOPIC'),
  ntfyToken: env('NTFY_TOKEN'),
  authUser: env('GANDRE_USER'),
  authPass: env('GANDRE_PASS'),
  timezone: env('GANDRE_TZ', 'Europe/Oslo')!,
  runTimeoutMs: Number(env('GANDRE_RUN_TIMEOUT_MIN', '30')) * 60_000,
};

export const dbPath = path.join(config.dataDir, 'gandre.db');
export const agentsDir = path.join(config.dataDir, 'agents');

export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'logs'), { recursive: true });
}

if (Number.isNaN(config.port) || Number.isNaN(config.runTimeoutMs)) {
  console.error('Ugyldig GANDRE_PORT eller GANDRE_RUN_TIMEOUT_MIN i .env');
  process.exit(1);
}
