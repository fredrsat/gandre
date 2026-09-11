import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { Agent, McpServer, Run } from '../types.js';
import { MODEL_SUGGESTIONS } from '../providers.js';
import { parseCron, describeCron, WEEKDAYS } from '../cron-ui.js';

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const CSS = `
:root { --bg:#f6f6f4; --fg:#1d1d1f; --muted:#6e6e73; --card:#fff; --line:#e2e2df; --accent:#3b6ea5; --ok:#2e7d32; --err:#c62828; --warn:#b26a00; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#1a1a1c; --fg:#eaeaea; --muted:#9a9aa0; --card:#242427; --line:#3a3a3e; --accent:#7aa7d4; --ok:#7dc98a; --err:#ef8b8b; --warn:#e0b060; }
}
* { box-sizing: border-box; }
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; }
main { max-width: 900px; margin: 0 auto; padding: 1.2rem 1.2rem 3rem; }
header { display: flex; align-items: center; gap: 1.2rem; border-bottom: 1px solid var(--line); padding: .6rem 1.2rem; background: var(--card); position: sticky; top: 0; z-index: 10; box-shadow: 0 1px 4px color-mix(in srgb, var(--fg) 5%, transparent); }
header a { color: var(--fg); text-decoration: none; }
header .brand { font-weight: 700; font-size: 1.05rem; letter-spacing: .01em; color: var(--accent); }
header nav { display: flex; gap: .3rem; flex-wrap: wrap; }
header nav a { color: var(--muted); padding: .3rem .85rem; border-radius: 99px; transition: background .12s, color .12s; }
header nav a:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--fg); }
header nav a.active { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); font-weight: 600; }
header nav a.cta { border: 1px solid var(--line); margin-left: .4rem; }
h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; }
a { color: var(--accent); }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
th, td { text-align: left; padding: .5rem .7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: none; }
th { color: var(--muted); font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; }
.badge { display: inline-block; padding: .1rem .5rem; border-radius: 99px; font-size: .78rem; font-weight: 600; }
.badge.success { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.badge.error { color: var(--err); background: color-mix(in srgb, var(--err) 12%, transparent); }
.badge.running { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.badge.interrupted { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, transparent); }
form.stack label { display: block; margin: .9rem 0 .2rem; font-weight: 600; font-size: .88rem; }
form.stack .hint { color: var(--muted); font-size: .8rem; margin: .1rem 0 0; }
input[type=text], input[type=number], select, textarea {
  width: 100%; padding: .45rem .6rem; border: 1px solid var(--line); border-radius: 6px;
  background: var(--card); color: var(--fg); font: inherit;
}
textarea { font-family: ui-monospace, monospace; font-size: .85rem; }
button { padding: .45rem .9rem; border: none; border-radius: 6px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
button.secondary { background: var(--card); color: var(--fg); border: 1px solid var(--line); }
button.danger { background: var(--err); }
.row { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
.actions { margin-top: 1.2rem; display: flex; gap: .6rem; }
.msg { padding: .6rem .8rem; border-radius: 6px; margin: .8rem 0; background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); }
.transcript { display: grid; gap: .6rem; }
.turn { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .6rem .8rem; }
.turn .role { color: var(--muted); font-size: .75rem; text-transform: uppercase; font-weight: 700; margin-bottom: .3rem; }
.turn pre { white-space: pre-wrap; word-break: break-word; margin: .3rem 0; font-size: .82rem; background: var(--bg); padding: .5rem; border-radius: 6px; overflow-x: auto; }
.turn p { margin: .2rem 0; white-space: pre-wrap; }
details summary { cursor: pointer; color: var(--muted); font-size: .85rem; }
form.stack details { margin-top: 1.2rem; border: 1px solid var(--line); border-radius: 8px; padding: .6rem .8rem; background: var(--card); }
form.stack details summary { font-weight: 600; }
.checklist { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .5rem .8rem; display: grid; gap: .3rem; }
.badge.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
.badge.feil { color: var(--err); background: color-mix(in srgb, var(--err) 12%, transparent); }
.badge.utestet { color: var(--muted); background: color-mix(in srgb, var(--muted) 12%, transparent); }
.msg.good { background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }
.sched { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .6rem .8rem; }
.sched select { width: auto; }
.sched input[type=number] { width: 4.5rem; }
.sched input[type=time] { width: auto; }
.sched input[type=text] { width: 12rem; font-family: ui-monospace, monospace; }
.daypick { display: inline-flex; gap: .25rem; }
.daypick label { border: 1px solid var(--line); border-radius: 6px; padding: .2rem .5rem; cursor: pointer; font-size: .85rem; user-select: none; }
.daypick input { display: none; }
.daypick label:has(input:checked) { background: color-mix(in srgb, var(--accent) 15%, transparent); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.meta { color: var(--muted); font-size: .85rem; }
input[type=checkbox] { width: auto; }
`;

export const statusBadge = (status: string): Html =>
  html`<span class="badge ${status}">${status}</span>`;

type NavKey = 'agents' | 'runs' | 'mcp' | 'new';

export function layout(title: string, body: Html, refresh = false, active?: NavKey): Html {
  const cls = (key: NavKey, extra = '') =>
    [active === key ? 'active' : '', extra].filter(Boolean).join(' ');
  return html`<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refresh ? raw('<meta http-equiv="refresh" content="5">') : ''}
  <title>${title} — gandre</title>
  <style>${raw(CSS)}</style>
</head>
<body>
  <header>
    <a class="brand" href="/">gandre</a>
    <nav>
      <a class="${cls('agents')}" href="/">Agenter</a>
      <a class="${cls('runs')}" href="/runs">Kjøringer</a>
      <a class="${cls('mcp')}" href="/mcp">MCP</a>
      <a class="${cls('new', 'cta')}" href="/agents/new">+ Ny agent</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

const fmtTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('no-NO', { dateStyle: 'short', timeStyle: 'short' }) : '–';

export function agentListPage(
  rows: { agent: Agent; last: Run | undefined; next: Date | null }[]
): Html {
  return layout(
    'Agenter',
    html`<h1>Agenter</h1>
    ${rows.length === 0
      ? html`<p>Ingen agenter ennå. <a href="/agents/new">Opprett den første.</a></p>`
      : html`<table>
      <tr><th>Navn</th><th>Modell</th><th>Kjøremønster</th><th>Neste</th><th>Siste kjøring</th><th></th></tr>
      ${rows.map(({ agent, last, next }) => html`<tr>
        <td><a href="/agents/${agent.id}">${agent.name}</a>${agent.enabled ? '' : html` <span class="meta">(av)</span>`}</td>
        <td class="meta">${agent.provider}/${agent.model}</td>
        <td class="meta">${describeCron(agent.schedule_cron)}</td>
        <td class="meta">${next ? fmtTime(next.toISOString()) : '–'}</td>
        <td>${last ? html`<a href="/runs/${last.id}">${statusBadge(last.status)}</a> <span class="meta">${fmtTime(last.started_at)}</span>` : html`<span class="meta">aldri</span>`}</td>
        <td><form method="post" action="/agents/${agent.id}/run"><button>Kjør nå</button></form></td>
      </tr>`)}
    </table>`}`,
    false,
    'agents'
  );
}

const PROVIDERS = ['anthropic', 'openrouter', 'ollama'] as const;

// Grafisk tidsvelger — genererer cron server-side ut fra disse feltene
function scheduleFields(cron: string | null): Html {
  const s = parseCron(cron);
  const time =
    s.type === 'daily' || s.type === 'weekly' || s.type === 'monthly' ? s.time : '07:00';
  const types = [
    ['manual', 'Kun manuell'], ['hourly', 'Hver time'], ['daily', 'Daglig'],
    ['weekly', 'Ukentlig'], ['monthly', 'Månedlig'], ['custom', 'Egendefinert (cron)'],
  ] as const;
  return html`<div class="sched">
    <select name="schedule_type" id="schedule_type">
      ${types.map(([v, label]) => html`<option value="${v}" ${s.type === v ? 'selected' : ''}>${label}</option>`)}
    </select>
    <span data-sched="hourly">på minutt
      <input type="number" name="sched_minute" min="0" max="59" value="${s.type === 'hourly' ? s.minute : 0}">
    </span>
    <span data-sched="weekly" class="daypick">
      ${WEEKDAYS.map((d) => html`<label>
        <input type="checkbox" name="sched_days" value="${d.value}"
          ${s.type === 'weekly' && s.days.includes(d.value) ? 'checked' : ''}>${d.label}</label>`)}
    </span>
    <span data-sched="monthly">den
      <input type="number" name="sched_dom" min="1" max="31" value="${s.type === 'monthly' ? s.dom : 1}">.
    </span>
    <span data-sched="daily weekly monthly">kl.
      <input type="time" name="sched_time" value="${time}">
    </span>
    <span data-sched="custom">
      <input type="text" name="schedule_cron" value="${s.type === 'custom' ? s.cron : ''}" placeholder="0 7 * * 1-5">
    </span>
  </div>
  <script>
    (function () {
      var sel = document.getElementById('schedule_type');
      function upd() {
        document.querySelectorAll('[data-sched]').forEach(function (el) {
          el.style.display = el.dataset.sched.split(' ').indexOf(sel.value) >= 0 ? '' : 'none';
        });
      }
      sel.addEventListener('change', upd);
      upd();
    })();
  </script>`;
}

export function agentFormPage(
  agent: Agent | null,
  mcpServers: McpServer[],
  error?: string,
  extra?: Html
): Html {
  const a = agent;
  const modelSuggestions = PROVIDERS.flatMap((p) => MODEL_SUGGESTIONS[p]);
  let selectedMcp: string[] = [];
  try { selectedMcp = JSON.parse(a?.mcp_server_ids ?? '[]'); } catch { /* tom liste */ }
  return layout(
    a ? `Rediger ${a.name}` : 'Ny agent',
    html`<h1>${a ? `Rediger ${a.name}` : 'Ny agent'}</h1>
    ${error ? html`<div class="msg">${error}</div>` : ''}
    <form class="stack" method="post" action="${a ? `/agents/${a.id}` : '/agents'}">
      <label>Navn</label>
      <input type="text" name="name" required value="${a?.name ?? ''}">

      <div class="row">
        <div style="flex:1">
          <label>Leverandør</label>
          <select name="provider">
            ${PROVIDERS.map((p) => html`<option value="${p}" ${a?.provider === p ? 'selected' : ''}>${p}</option>`)}
          </select>
        </div>
        <div style="flex:2">
          <label>Modell</label>
          <input type="text" name="model" required list="models" value="${a?.model ?? ''}" placeholder="claude-opus-5, qwen3:14b, …">
          <datalist id="models">${modelSuggestions.map((m) => html`<option value="${m}">`)}</datalist>
        </div>
      </div>

      <label>Kjøremønster</label>
      ${scheduleFields(a?.schedule_cron ?? null)}
      <p class="hint">Tidssone Europe/Oslo. Kjøretidspunkter som passerer mens serveren er av, hoppes over.</p>

      <label>System-prompt (rolle/instruksjoner)</label>
      <textarea name="system_prompt" rows="4">${a?.system_prompt ?? ''}</textarea>

      <label>Oppgave-prompt (kjøres hver gang)</label>
      <textarea name="task_prompt" rows="6" required>${a?.task_prompt ?? ''}</textarea>

      <label>Arbeidsmappe (datagrunnlag)</label>
      <input type="text" name="workdir" value="${a?.workdir ?? ''}" placeholder="tom = data/agents/&lt;id&gt; opprettes automatisk">
      <p class="hint">Agenten kan lese filer her (og skrive hvis tillatt under). Absolutt sti.</p>

      <label class="row"><input type="checkbox" name="allow_write" ${a?.allow_write ? 'checked' : ''}> Tillat skriving til arbeidsmappen</label>

      <label>MCP-servere (verktøy)</label>
      ${mcpServers.length === 0
        ? html`<p class="hint">Ingen MCP-servere registrert ennå — <a href="/mcp/new">legg til en i registeret</a> først.</p>`
        : html`<div class="checklist">${mcpServers.map((s) => html`<label class="row">
            <input type="checkbox" name="mcp" value="${s.id}" ${selectedMcp.includes(s.id) ? 'checked' : ''}>
            ${s.name} <span class="meta">${mcpSummary(s)}</span>
          </label>`)}</div>
          <p class="hint">Administrer serverne i <a href="/mcp">MCP-registeret</a>.</p>`}

      <details ${a && (a.api_key || a.base_url || a.ntfy_url || a.ntfy_topic || a.ntfy_token) ? raw('open') : ''}>
        <summary>Overstyringer for denne agenten (API-nøkkel, ntfy)</summary>
        <label>API-nøkkel</label>
        <input type="password" name="api_key" value="${a?.api_key ?? ''}" autocomplete="off" placeholder="tom = bruk nøkkelen fra .env">
        <label>Base-URL (kun ollama)</label>
        <input type="text" name="base_url" value="${a?.base_url ?? ''}" placeholder="tom = OLLAMA_BASE_URL fra .env">
        <label>ntfy-URL</label>
        <input type="text" name="ntfy_url" value="${a?.ntfy_url ?? ''}" placeholder="tom = NTFY_URL fra .env">
        <label>ntfy-topic</label>
        <input type="text" name="ntfy_topic" value="${a?.ntfy_topic ?? ''}" placeholder="tom = NTFY_TOPIC fra .env">
        <label>ntfy-token</label>
        <input type="password" name="ntfy_token" value="${a?.ntfy_token ?? ''}" autocomplete="off" placeholder="tom = NTFY_TOKEN fra .env">
      </details>

      <div class="row">
        <div>
          <label>Maks steg</label>
          <input type="number" name="max_steps" min="1" max="200" value="${a?.max_steps ?? 25}">
          <p class="hint">Ett steg = én runde mot modellen; hver verktøybruk krever en ny runde. Grensen stopper agenter som går i loop.</p>
        </div>
        <label class="row" style="margin-top:2rem"><input type="checkbox" name="enabled" ${!a || a.enabled ? 'checked' : ''}> Aktivert</label>
      </div>

      <div class="actions">
        <button type="submit">${a ? 'Lagre' : 'Opprett'}</button>
        <a href="/"><button type="button" class="secondary">Avbryt</button></a>
      </div>
    </form>
    ${a ? html`<form method="post" action="/agents/${a.id}/delete" style="margin-top:2rem" onsubmit="return confirm('Slette agenten og all historikk?')">
      <button class="danger">Slett agent</button>
    </form>` : ''}
    ${extra ?? ''}`,
    false,
    a ? 'agents' : 'new'
  );
}

export function agentDetailRuns(agent: Agent, runs: Run[], memory: string): Html {
  return html`<h2 style="margin-top:2rem">Minne</h2>
  ${memory
    ? html`<div class="turn"><pre>${memory}</pre></div>
      <p class="hint">Agenten leser dette før hver kjøring og oppdaterer det selv med save_memory-verktøyet (memory.md i arbeidsmappen).</p>`
    : html`<p class="meta">Tomt — agenten bygger minnet selv med save_memory-verktøyet ved første kjøring.</p>`}
  <h2 style="margin-top:2rem">Siste kjøringer</h2>
  ${runs.length === 0 ? html`<p class="meta">Ingen kjøringer ennå.</p>` : runTable(runs, null)}
  <p><a href="/runs?agent=${agent.id}">Full historikk →</a></p>`;
}

function runTable(runs: Run[], agentNames: Map<string, string> | null): Html {
  return html`<table>
    <tr><th>#</th>${agentNames ? html`<th>Agent</th>` : ''}<th>Status</th><th>Start</th><th>Slutt</th><th>Utløst</th><th>Resultat</th></tr>
    ${runs.map((r) => html`<tr>
      <td><a href="/runs/${r.id}">${r.id}</a></td>
      ${agentNames ? html`<td class="meta">${agentNames.get(r.agent_id) ?? r.agent_id}</td>` : ''}
      <td>${statusBadge(r.status)}</td>
      <td class="meta">${fmtTime(r.started_at)}</td>
      <td class="meta">${fmtTime(r.finished_at)}</td>
      <td class="meta">${r.trigger === 'schedule' ? 'planlagt' : 'manuell'}</td>
      <td class="meta">${(r.final_text ?? r.error ?? '').slice(0, 80)}</td>
    </tr>`)}
  </table>`;
}

export function runListPage(
  runs: Run[],
  agents: Agent[],
  agentFilter: string | null,
  page: number
): Html {
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const qs = (p: number) => `?${agentFilter ? `agent=${agentFilter}&` : ''}page=${p}`;
  return layout(
    'Kjøringer',
    html`<h1>Kjøringer${agentFilter ? html` <span class="meta">— ${names.get(agentFilter) ?? ''}</span>` : ''}</h1>
    ${runs.length === 0 ? html`<p class="meta">Ingen kjøringer.</p>` : runTable(runs, names)}
    <p class="row">
      ${page > 1 ? html`<a href="${qs(page - 1)}">← Nyere</a>` : ''}
      ${runs.length === 50 ? html`<a href="${qs(page + 1)}">Eldre →</a>` : ''}
    </p>`,
    false,
    'runs'
  );
}

export function mcpSummary(server: McpServer): string {
  try {
    const cfg = JSON.parse(server.config) as Record<string, unknown>;
    if (cfg.transport === 'stdio') {
      return `stdio: ${cfg.command} ${(cfg.args as string[] | undefined)?.join(' ') ?? ''}`.trim();
    }
    return `${cfg.transport}: ${cfg.url}`;
  } catch {
    return '(ugyldig konfigurasjon)';
  }
}

export function mcpListPage(
  rows: { server: McpServer; usedBy: Agent[] }[],
  importError?: string
): Html {
  return layout(
    'MCP-servere',
    html`<h1>MCP-servere</h1>
    <p class="meta">Verktøyservere plattformen kjenner til. «Test» kobler til serveren og lister verktøyene den tilbyr.</p>
    ${importError ? html`<div class="msg">${importError}</div>` : ''}
    ${rows.length === 0
      ? html`<p>Ingen MCP-servere registrert. <a href="/mcp/new">Legg til den første.</a></p>`
      : html`<table>
      <tr><th>Navn</th><th>Tilkobling</th><th>Status</th><th>Verktøy</th><th>Brukes av</th><th></th></tr>
      ${rows.map(({ server, usedBy }) => {
        let tools: string[] = [];
        try { tools = JSON.parse(server.last_tools ?? '[]'); } catch { /* vis tom */ }
        const statusClass = server.last_status == null ? 'utestet' : server.last_status === 'ok' ? 'ok' : 'feil';
        const statusText = server.last_status == null ? 'utestet' : server.last_status === 'ok' ? 'ok' : 'feil';
        return html`<tr>
        <td><a href="/mcp/${server.id}">${server.name}</a></td>
        <td class="meta">${mcpSummary(server)}</td>
        <td>
          <span class="badge ${statusClass}" title="${server.last_status ?? ''}">${statusText}</span>
          ${server.last_checked ? html`<div class="meta">${fmtTime(server.last_checked)}</div>` : ''}
          ${server.last_status && server.last_status !== 'ok' ? html`<div class="meta">${server.last_status.slice(0, 120)}</div>` : ''}
        </td>
        <td class="meta">${tools.length > 0
          ? html`<details><summary>${tools.length} verktøy</summary>${tools.join(', ')}</details>`
          : '–'}</td>
        <td>${usedBy.length === 0
          ? html`<span class="meta">ingen</span>`
          : usedBy.map((a, i) => html`${i > 0 ? ', ' : ''}<a href="/agents/${a.id}">${a.name}</a>`)}</td>
        <td><form method="post" action="/mcp/${server.id}/test"><button class="secondary">Test</button></form></td>
      </tr>`;
      })}
    </table>`}
    <h2 style="margin-top:2rem">Legg til server</h2>
    <form method="post" action="/mcp/import" class="row">
      <input type="text" name="source" required style="flex:1; min-width: 16rem"
        placeholder="GitHub-URL eller npm-pakkenavn, f.eks. github.com/modelcontextprotocol/servers/tree/main/src/memory">
      <button>Hent oppsett</button>
    </form>
    <p class="hint">Henter README/package.json og fyller ut registrerings-skjemaet automatisk — ingenting installeres før du lagrer og tester.
      Eller <a href="/mcp/new">sett opp manuelt</a>.</p>`,
    false,
    'mcp'
  );
}

export function mcpFormPage(
  server: McpServer | null,
  usedBy: Agent[],
  error?: string,
  notice?: string
): Html {
  const s = server;
  return layout(
    s?.id ? `Rediger ${s.name}` : 'Ny MCP-server',
    html`<h1>${s?.id ? `Rediger ${s.name}` : 'Ny MCP-server'}</h1>
    ${error ? html`<div class="msg">${error}</div>` : ''}
    ${notice ? html`<div class="msg good">${notice}</div>` : ''}
    <form class="stack" method="post" action="${s?.id ? `/mcp/${s.id}` : '/mcp'}">
      <label>Navn</label>
      <input type="text" name="name" required value="${s?.name ?? ''}" placeholder="f.eks. filesystem, tibber, feedly">

      <label>Konfigurasjon (JSON)</label>
      <textarea name="config" rows="8" spellcheck="false" required>${s?.config ?? '{\n  "transport": "stdio",\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/en/mappe"]\n}'}</textarea>
      <p class="hint">stdio: {"transport":"stdio","command":"npx","args":[…],"env":{…}} ·
        ekstern: {"transport":"http","url":"https://…/mcp","headers":{…}}</p>

      <div class="actions">
        <button type="submit">${s?.id ? 'Lagre' : 'Opprett'}</button>
        <a href="/mcp"><button type="button" class="secondary">Avbryt</button></a>
      </div>
    </form>
    ${s?.id ? html`
      <p class="meta" style="margin-top:1.5rem">Brukes av: ${usedBy.length === 0 ? 'ingen agenter' : ''}
        ${usedBy.map((a, i) => html`${i > 0 ? ', ' : ''}<a href="/agents/${a.id}">${a.name}</a>`)}</p>
      <form method="post" action="/mcp/${s.id}/delete" onsubmit="return confirm('Slette serveren? Den fjernes også fra agentene som bruker den.')">
        <button class="danger">Slett server</button>
      </form>` : ''}`,
    false,
    'mcp'
  );
}

function renderPart(part: Record<string, unknown>): Html {
  const type = String(part.type ?? '');
  if (type === 'text' || type === 'reasoning') {
    return html`<p>${String(part.text ?? '')}</p>`;
  }
  if (type === 'tool-call' || type.startsWith('tool-')) {
    const name = String(part.toolName ?? type);
    const payload = part.input ?? part.args ?? part.output ?? part.result ?? part;
    const isResult = type === 'tool-result' || 'output' in part || 'result' in part;
    return html`<details ${isResult ? '' : raw('open')}>
      <summary>${isResult ? 'Resultat fra' : 'Verktøykall:'} <b>${name}</b></summary>
      <pre>${JSON.stringify(payload, null, 2)}</pre>
    </details>`;
  }
  return html`<details><summary>${type || 'ukjent'}</summary><pre>${JSON.stringify(part, null, 2)}</pre></details>`;
}

export function runDetailPage(run: Run, agent: Agent | undefined): Html {
  let transcript: Html = html``;
  if (run.transcript_json) {
    try {
      const messages = JSON.parse(run.transcript_json) as { role: string; content: unknown }[];
      transcript = html`<div class="transcript">${messages.map(
        (m) => html`<div class="turn">
          <div class="role">${m.role}</div>
          ${Array.isArray(m.content)
            ? m.content.map((p) => renderPart(p as Record<string, unknown>))
            : html`<p>${String(m.content)}</p>`}
        </div>`
      )}</div>`;
    } catch {
      transcript = html`<pre>${run.transcript_json}</pre>`;
    }
  }
  let usage = '';
  if (run.usage_json) {
    try {
      const u = JSON.parse(run.usage_json) as Record<string, number>;
      usage = ` · ${u.inputTokens ?? '?'} inn / ${u.outputTokens ?? '?'} ut tokens`;
    } catch { /* vis uten tokens */ }
  }
  return layout(
    `Kjøring #${run.id}`,
    html`<h1>Kjøring #${run.id} ${statusBadge(run.status)}</h1>
    <p class="meta">
      ${agent ? html`<a href="/agents/${agent.id}">${agent.name}</a> · ` : ''}
      ${run.trigger === 'schedule' ? 'planlagt' : 'manuell'} ·
      ${fmtTime(run.started_at)} → ${fmtTime(run.finished_at)}
      ${run.step_count != null ? ` · ${run.step_count} steg` : ''}${usage}
    </p>
    ${run.status === 'running' ? html`<p class="meta">Kjører … siden oppdateres automatisk.</p>` : ''}
    ${run.error ? html`<div class="msg"><pre style="margin:0">${run.error}</pre></div>` : ''}
    ${run.final_text ? html`<div class="turn"><div class="role">Sluttsvar</div><p>${run.final_text}</p></div>` : ''}
    ${transcript ? html`<h2>Transkript</h2>${transcript}` : ''}`,
    run.status === 'running',
    'runs'
  );
}
