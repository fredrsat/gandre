import { config } from './config.js';
import type { Agent } from './types.js';

export async function notifyRunFinished(
  agent: Agent,
  runId: number,
  ok: boolean,
  summary: string,
  topicSuffix?: string
): Promise<void> {
  // ntfy-topics er et globalt navnerom — basetopicet (agent/.env) er hemmeligheten.
  // [TOPIC:x]-markøren legges derfor på som suffiks: <base>-<x>, aldri alene.
  const url = agent.ntfy_url || config.ntfyUrl;
  const base = agent.ntfy_topic || config.ntfyTopic;
  const topic = base && topicSuffix ? `${base}-${topicSuffix}` : base;
  const token = agent.ntfy_token || config.ntfyToken;
  if (!topic) return;
  // Tittel m.m. som query-parametre: HTTP-headere tåler ikke UTF-8 (æøå i agentnavn)
  const params = new URLSearchParams({
    title: ok ? `✓ ${agent.name}` : `✗ ${agent.name} feilet`,
    priority: ok ? 'default' : 'high',
    tags: ok ? 'white_check_mark' : 'rotating_light',
  });
  // Klikk-lenke kun når det finnes en adresse mobilen faktisk kan nå
  if (config.publicUrl) params.set('click', `${config.publicUrl}/runs/${runId}`);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    await fetch(`${url}/${topic}?${params}`, {
      method: 'POST',
      headers,
      body: summary.slice(0, 300) || (ok ? 'Ferdig' : 'Feilet'),
    });
  } catch (err) {
    console.error('ntfy-varsling feilet:', err);
  }
}
