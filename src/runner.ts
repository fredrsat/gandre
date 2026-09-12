import { generateText, stepCountIs } from 'ai';
import { config } from './config.js';
import { getAgent, getMcpServer, agentMcpServerIds, insertRun, finishRun, getRun } from './db.js';
import { resolveModel } from './providers.js';
import { buildFsTools, buildMemoryTool, readMemory } from './tools/fs-tools.js';
import { connectMcpServers, type McpConnection } from './mcp.js';
import { notifyRunFinished } from './notify.js';
import type { RunTrigger } from './types.js';

const activeAgents = new Set<string>();

export type RunResult = { runId: number } | { skipped: 'busy' | 'missing' | 'disabled' };

interface RunOpts {
  suppressErrorNotify?: boolean; // brukes av retry: varsle først når siste forsøk har feilet
}

export async function executeRun(
  agentId: string,
  trigger: RunTrigger,
  opts: RunOpts = {}
): Promise<RunResult> {
  const agent = getAgent(agentId);
  if (!agent) return { skipped: 'missing' };
  if (trigger === 'schedule' && !agent.enabled) return { skipped: 'disabled' };
  if (activeAgents.has(agentId)) {
    console.log(`[runner] ${agent.name}: kjører allerede — hopper over (${trigger})`);
    return { skipped: 'busy' };
  }
  activeAgents.add(agentId);

  const runId = insertRun(agentId, trigger);
  console.log(`[runner] ${agent.name}: starter kjøring #${runId} (${trigger})`);

  let mcp: McpConnection | null = null;
  try {
    const model = resolveModel(agent.provider, agent.model, {
      apiKey: agent.api_key,
      baseUrl: agent.base_url,
    });
    const fsTools = buildFsTools(agent.workdir, agent.allow_write === 1);
    const servers = agentMcpServerIds(agent).flatMap((id) => {
      const server = getMcpServer(id);
      if (!server) console.warn(`[runner] ${agent.name}: MCP-server ${id} finnes ikke lenger — hopper over`);
      return server ? [server] : [];
    });
    mcp = await connectMcpServers(servers);
    const tools = { ...fsTools, ...buildMemoryTool(agent.workdir), ...mcp.tools };

    const memory = readMemory(agent.workdir);
    const memorySection = memory
      ? `\n\n## Minne fra tidligere kjøringer\n${memory}\n\nOppdater minnet med save_memory-verktøyet før du avslutter, slik at neste kjøring vet hva som er gjort.`
      : `\n\n(Minnet ditt er tomt — dette er trolig første kjøring. Lagre det neste kjøring bør vite med save_memory-verktøyet.)`;

    const result = await generateText({
      model,
      instructions: agent.system_prompt || undefined,
      prompt:
        agent.task_prompt +
        memorySection +
        `\n\n(Kjørt: ${new Date().toISOString()}, arbeidsmappe: ${agent.workdir})`,
      tools,
      stopWhen: stepCountIs(agent.max_steps),
      abortSignal: AbortSignal.timeout(config.runTimeoutMs),
    });

    // Småmodeller skriver av og til svaret, kaller så et verktøy, og avslutter
    // med bare «ferdig»/«ok». Da er den ekte meldingen i et tidligere steg —
    // bruk siste substansielle tekst i stedet for det trivielle sluttsvaret.
    let finalText = result.text.trim();
    if (finalText.length < 20) {
      const substantial = result.steps
        .map((s) => s.text?.trim() ?? '')
        .filter((t) => t.length >= 20);
      if (substantial.length > 0) finalText = substantial[substantial.length - 1];
    }

    finishRun(runId, {
      status: 'success',
      final_text: finalText,
      transcript_json: JSON.stringify(result.responseMessages),
      usage_json: JSON.stringify(result.usage),
      step_count: result.steps.length,
    });
    console.log(`[runner] ${agent.name}: kjøring #${runId} ferdig (${result.steps.length} steg)`);
    // [STILLE]-konvensjonen: starter sluttsvaret slik, droppes push-varselet
    // (kjøringen logges som vanlig). Feil varsles alltid.
    // Markører først i sluttsvaret, i valgfri rekkefølge:
    //   [STILLE]       — ingen push (kjøringen logges som vanlig)
    //   [TOPIC:navn]   — rut pushen til et annet ntfy-topic (url/token som ellers)
    let message = finalText;
    let silent = false;
    let topicOverride: string | undefined;
    for (;;) {
      if (message.startsWith('[STILLE]')) {
        silent = true;
        message = message.slice('[STILLE]'.length).trimStart();
        continue;
      }
      const m = message.match(/^\[TOPIC:([A-Za-z0-9_-]{1,64})\]\s*/);
      if (m) {
        topicOverride = m[1];
        message = message.slice(m[0].length);
        continue;
      }
      break;
    }
    if (silent) {
      console.log(`[runner] ${agent.name}: [STILLE] — hopper over ntfy-varsel`);
    } else {
      await notifyRunFinished(agent, runId, true, message, topicOverride);
    }
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    finishRun(runId, { status: 'error', error: message });
    console.error(`[runner] ${agent.name}: kjøring #${runId} feilet:`, message);
    if (!opts.suppressErrorNotify) {
      await notifyRunFinished(agent, runId, false, err instanceof Error ? err.message : String(err));
    }
  } finally {
    if (mcp) await mcp.close().catch(() => {});
    activeAgents.delete(agentId);
  }
  return { runId };
}

export function isAgentRunning(agentId: string): boolean {
  return activeAgents.has(agentId);
}

// Planlagte kjøringer: inntil `attempts` forsøk totalt, feilvarsel først når siste har feilet.
// Manuelle kjøringer bruker executeRun direkte — der ser brukeren feilen med en gang.
export async function executeScheduledRun(
  agentId: string,
  attempts = 3,
  delayMs = 60_000
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await executeRun(agentId, 'schedule', {
      suppressErrorNotify: attempt < attempts,
    });
    if ('skipped' in result) return;
    if (getRun(result.runId)?.status === 'success') return;
    if (attempt < attempts) {
      console.log(`[runner] forsøk ${attempt}/${attempts} feilet — prøver igjen om ${delayMs / 1000}s`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
