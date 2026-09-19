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

  // Kaster insertRun (full disk, låst/korrupt db) FØR try-blokken under, må
  // busy-flagget ryddes her — ellers står agenten som «kjører» for alltid og
  // alle senere kjøringer hoppes stille over.
  let runId: number;
  try {
    runId = insertRun(agentId, trigger);
  } catch (err) {
    activeAgents.delete(agentId);
    throw err;
  }
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
      // Prompt-caching (Anthropic): auto-cache siste blokk per steg, slik at
      // system-prompt, verktøyliste og historikk gjenbrukes billig gjennom
      // flerstegs kjøringer (cache-les koster ~10 % av full pris)
      providerOptions:
        agent.provider === 'anthropic'
          ? { anthropic: { cacheControl: { type: 'ephemeral' } } }
          : undefined,
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
    const cached = result.usage.inputTokenDetails.cacheReadTokens ?? 0;
    console.log(
      `[runner] ${agent.name}: kjøring #${runId} ferdig (${result.steps.length} steg, ` +
      `${result.usage.inputTokens ?? 0} inn / ${result.usage.outputTokens ?? 0} ut` +
      (cached > 0 ? `, ${cached} fra cache` : '') + ')'
    );
    // [STILLE]-konvensjonen: starter sluttsvaret slik, droppes push-varselet
    // (kjøringen logges som vanlig). Feil varsles alltid.
    // Markører i sluttsvaret:
    //   [STILLE] først        — ingen push i det hele tatt (kjøringen logges)
    //   [TOPIC:suffiks]       — starter en seksjon som pushes til <NTFY_TOPIC>-<suffiks>.
    //                           Flere markører = flere push, én per seksjon.
    let message = finalText;
    let silent = false;
    if (message.startsWith('[STILLE]')) {
      silent = true;
      message = message.slice('[STILLE]'.length).trimStart();
    }
    if (silent) {
      console.log(`[runner] ${agent.name}: [STILLE] — hopper over ntfy-varsel`);
    } else {
      // Del opp i seksjoner per [TOPIC:x]-markør; tekst før første markør går til standard-topicet
      const parts = message.split(/\[TOPIC:([A-Za-z0-9_-]{1,64})\]/);
      const segments: { suffix?: string; text: string }[] = [];
      if (parts[0].trim()) segments.push({ text: parts[0].trim() });
      for (let i = 1; i < parts.length; i += 2) {
        const text = (parts[i + 1] ?? '').trim();
        if (text) segments.push({ suffix: parts[i], text });
      }
      if (segments.length === 0) segments.push({ text: message.trim() });
      for (const seg of segments) {
        await notifyRunFinished(agent, runId, true, seg.text, seg.suffix);
      }
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
