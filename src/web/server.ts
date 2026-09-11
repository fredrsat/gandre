import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { serve } from '@hono/node-server';
import { config } from '../config.js';
import {
  listAgents, getAgent, createAgent, updateAgent, deleteAgent,
  listMcpServers, getMcpServer, createMcpServer, updateMcpServer, deleteMcpServer,
  setMcpServerStatus, agentsUsingMcpServer,
  listRuns, getRun, lastRun, type AgentInput,
} from '../db.js';
import { executeRun } from '../runner.js';
import { reloadScheduler, nextRun, validateCron } from '../scheduler.js';
import { parseMcpConfig, testMcpServer } from '../mcp.js';
import { importMcpSetup } from '../mcp-import.js';
import { readMemory } from '../tools/fs-tools.js';
import { buildCron, type Schedule } from '../cron-ui.js';
import {
  agentListPage, agentFormPage, agentDetailRuns, runListPage, runDetailPage,
  mcpListPage, mcpFormPage,
} from './pages.js';

const app = new Hono();

if (config.authUser && config.authPass) {
  app.use('*', basicAuth({ username: config.authUser, password: config.authPass }));
}

app.get('/healthz', (c) => c.text('ok'));

app.get('/', (c) => {
  const rows = listAgents().map((agent) => ({
    agent,
    last: lastRun(agent.id),
    next: nextRun(agent.id),
  }));
  return c.html(agentListPage(rows));
});

app.get('/agents/new', (c) => c.html(agentFormPage(null, listMcpServers())));

// Oversetter tidsvelger-feltene til et cron-uttrykk
function readSchedule(form: FormData): { cron: string | null; error?: string } {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v || lo));
  const time = /^\d{2}:\d{2}$/.test(str('sched_time')) ? str('sched_time') : '07:00';
  let schedule: Schedule;
  switch (str('schedule_type')) {
    case 'hourly': schedule = { type: 'hourly', minute: clamp(Number(str('sched_minute')), 0, 59) }; break;
    case 'daily': schedule = { type: 'daily', time }; break;
    case 'weekly': {
      const days = form.getAll('sched_days').map(Number).filter((d) => d >= 0 && d <= 6);
      if (days.length === 0) return { cron: null, error: 'Velg minst én ukedag for ukentlig kjøring.' };
      schedule = { type: 'weekly', days, time };
      break;
    }
    case 'monthly': schedule = { type: 'monthly', dom: clamp(Number(str('sched_dom')), 1, 31), time }; break;
    case 'custom': schedule = { type: 'custom', cron: str('schedule_cron') }; break;
    default: schedule = { type: 'manual' };
  }
  const cron = buildCron(schedule);
  if (cron && !validateCron(cron)) return { cron: null, error: `Ugyldig cron-uttrykk: «${cron}»` };
  return { cron };
}

function readAgentForm(form: FormData): { input: AgentInput; error?: string } {
  const str = (k: string) => String(form.get(k) ?? '').trim();
  const opt = (k: string) => str(k) || null;
  const knownServers = new Set(listMcpServers().map((s) => s.id));
  const schedule = readSchedule(form);
  const input: AgentInput = {
    name: str('name'),
    enabled: form.get('enabled') != null,
    schedule_cron: schedule.cron,
    provider: str('provider'),
    model: str('model'),
    api_key: opt('api_key'),
    base_url: opt('base_url'),
    system_prompt: String(form.get('system_prompt') ?? '').trim(),
    task_prompt: String(form.get('task_prompt') ?? '').trim(),
    workdir: opt('workdir'),
    allow_write: form.get('allow_write') != null,
    mcp_server_ids: form.getAll('mcp').map(String).filter((id) => knownServers.has(id)),
    max_steps: Math.max(1, Math.min(200, Number(str('max_steps')) || 25)),
    ntfy_url: opt('ntfy_url'),
    ntfy_topic: opt('ntfy_topic'),
    ntfy_token: opt('ntfy_token'),
  };
  if (schedule.error) return { input, error: schedule.error };
  if (!input.name || !input.model || !input.task_prompt) {
    return { input, error: 'Navn, modell og oppgave-prompt er påkrevd.' };
  }
  if (!['anthropic', 'openrouter', 'ollama'].includes(input.provider)) {
    return { input, error: `Ukjent leverandør: ${input.provider}` };
  }
  return { input };
}

// Gjenbruker skjemaet med innsendte verdier ved valideringsfeil
function formEcho(id: string | null, input: AgentInput) {
  return {
    id: id ?? '', name: input.name, enabled: input.enabled ? 1 : 0,
    schedule_cron: input.schedule_cron, provider: input.provider as never, model: input.model,
    api_key: input.api_key, base_url: input.base_url,
    system_prompt: input.system_prompt, task_prompt: input.task_prompt,
    workdir: input.workdir ?? '', allow_write: input.allow_write ? 1 : 0,
    mcp_server_ids: JSON.stringify(input.mcp_server_ids), max_steps: input.max_steps,
    ntfy_url: input.ntfy_url, ntfy_topic: input.ntfy_topic, ntfy_token: input.ntfy_token,
    created_at: '', updated_at: '',
  };
}

app.post('/agents', async (c) => {
  const { input, error } = readAgentForm(await c.req.formData());
  if (error) return c.html(agentFormPage(formEcho(null, input), listMcpServers(), error), 400);
  const agent = createAgent(input);
  reloadScheduler();
  return c.redirect(`/agents/${agent.id}`);
});

app.get('/agents/:id', (c) => {
  const agent = getAgent(c.req.param('id'));
  if (!agent) return c.notFound();
  const runs = listRuns(agent.id, 20, 0);
  return c.html(agentFormPage(
    agent, listMcpServers(), undefined,
    agentDetailRuns(agent, runs, readMemory(agent.workdir))
  ));
});

app.post('/agents/:id', async (c) => {
  const agent = getAgent(c.req.param('id'));
  if (!agent) return c.notFound();
  const { input, error } = readAgentForm(await c.req.formData());
  if (error) return c.html(agentFormPage(formEcho(agent.id, input), listMcpServers(), error), 400);
  updateAgent(agent.id, input);
  reloadScheduler();
  return c.redirect('/');
});

app.post('/agents/:id/delete', (c) => {
  const agent = getAgent(c.req.param('id'));
  if (!agent) return c.notFound();
  deleteAgent(agent.id);
  reloadScheduler();
  return c.redirect('/');
});

app.post('/agents/:id/run', async (c) => {
  const agent = getAgent(c.req.param('id'));
  if (!agent) return c.notFound();
  const result = executeRun(agent.id, 'manual'); // fire-and-forget
  // Vent kort så runs-raden rekker å bli opprettet, og pek til den
  const settled = await Promise.race([result, new Promise((r) => setTimeout(r, 300))]);
  if (settled && typeof settled === 'object' && 'skipped' in settled) {
    return c.redirect(`/agents/${agent.id}`);
  }
  const last = lastRun(agent.id);
  return c.redirect(last && last.status === 'running' ? `/runs/${last.id}` : `/agents/${agent.id}`);
});

// --- MCP-register ---

app.get('/mcp', (c) => {
  const rows = listMcpServers().map((server) => ({
    server,
    usedBy: agentsUsingMcpServer(server.id),
  }));
  return c.html(mcpListPage(rows));
});

app.get('/mcp/new', (c) => c.html(mcpFormPage(null, [])));

// Hent oppsett fra GitHub/npm og forhåndsutfyll registrerings-skjemaet
app.post('/mcp/import', async (c) => {
  const form = await c.req.formData();
  const source = String(form.get('source') ?? '');
  try {
    const result = await importMcpSetup(source);
    return c.html(mcpFormPage(
      { id: '', name: result.name, config: result.config, last_status: null, last_checked: null, last_tools: null, created_at: '', updated_at: '' },
      [], undefined, result.note
    ));
  } catch (err) {
    const rows = listMcpServers().map((server) => ({ server, usedBy: agentsUsingMcpServer(server.id) }));
    return c.html(mcpListPage(rows, err instanceof Error ? err.message : String(err)), 400);
  }
});

function readMcpForm(form: FormData): { name: string; config: string; error?: string } {
  const name = String(form.get('name') ?? '').trim();
  const rawConfig = String(form.get('config') ?? '').trim();
  if (!name) return { name, config: rawConfig, error: 'Navn er påkrevd.' };
  try {
    parseMcpConfig(rawConfig);
    return { name, config: JSON.stringify(JSON.parse(rawConfig), null, 2) };
  } catch (err) {
    return { name, config: rawConfig, error: `Ugyldig konfigurasjon: ${err instanceof Error ? err.message : err}` };
  }
}

const mcpEcho = (id: string | null, name: string, config: string) => ({
  id: id ?? '', name, config, last_status: null, last_checked: null, last_tools: null,
  created_at: '', updated_at: '',
});

app.post('/mcp', async (c) => {
  const { name, config: cfg, error } = readMcpForm(await c.req.formData());
  if (error) return c.html(mcpFormPage(mcpEcho(null, name, cfg), [], error), 400);
  createMcpServer(name, cfg);
  return c.redirect('/mcp');
});

app.get('/mcp/:id', (c) => {
  const server = getMcpServer(c.req.param('id'));
  if (!server) return c.notFound();
  return c.html(mcpFormPage(server, agentsUsingMcpServer(server.id)));
});

app.post('/mcp/:id', async (c) => {
  const server = getMcpServer(c.req.param('id'));
  if (!server) return c.notFound();
  const { name, config: cfg, error } = readMcpForm(await c.req.formData());
  if (error) return c.html(mcpFormPage(mcpEcho(server.id, name, cfg), agentsUsingMcpServer(server.id), error), 400);
  updateMcpServer(server.id, name, cfg);
  return c.redirect('/mcp');
});

app.post('/mcp/:id/test', async (c) => {
  const server = getMcpServer(c.req.param('id'));
  if (!server) return c.notFound();
  const result = await testMcpServer(server);
  setMcpServerStatus(server.id, result.ok ? 'ok' : `feil: ${result.error}`, result.ok ? result.tools : null);
  return c.redirect('/mcp');
});

app.post('/mcp/:id/delete', (c) => {
  const server = getMcpServer(c.req.param('id'));
  if (!server) return c.notFound();
  deleteMcpServer(server.id);
  return c.redirect('/mcp');
});

app.get('/runs', (c) => {
  const agentFilter = c.req.query('agent') ?? null;
  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const runs = listRuns(agentFilter, 50, (page - 1) * 50);
  return c.html(runListPage(runs, listAgents(), agentFilter, page));
});

app.get('/runs/:id', (c) => {
  const run = getRun(Number(c.req.param('id')));
  if (!run) return c.notFound();
  return c.html(runDetailPage(run, getAgent(run.agent_id)));
});

export function startWebServer(): void {
  serve({ fetch: app.fetch, port: config.port, hostname: config.bind }, (info) => {
    console.log(`[web] gandre lytter på http://${config.bind}:${info.port}`);
  });
}
