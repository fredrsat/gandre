// Utleder MCP-serveroppsett fra en GitHub-URL eller et npm-pakkenavn.
// Henter README/package.json og leter etter mcpServers-konfigurasjon —
// ingen kode installeres eller kjøres før brukeren lagrer og tester selv.

export interface McpImportResult {
  name: string;
  config: string; // JSON-tekst klar for skjemaet
  note: string;   // hva som ble funnet / hva brukeren må fylle inn
}

const FETCH_OPTS = { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'gandre' } };

// null = finnes ikke (404 o.l.). Nettverksfeil kaster — det skal gi en tydelig
// feilmelding til brukeren, ikke forveksles med «fant ingen konfigurasjon».
async function fetchText(url: string): Promise<string | null> {
  let lastErr: unknown;
  // To forsøk: forbigående nettverksfeil (f.eks. en død keep-alive-tilkobling) skal ikke velte importen
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, FETCH_OPTS);
      return res.ok ? await res.text() : null;
    } catch (err) {
      lastErr = err;
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.error(`[mcp-import] klarte ikke hente ${url}: ${reason}`);
  throw new Error(
    `Fikk ikke kontakt med ${new URL(url).host} (${reason}) — sjekk nettverket fra serveren og prøv igjen.`
  );
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const text = await fetchText(url);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// README-JSON er ofte ikke strikt gyldig (kommentarer, hengende komma) — vask litt før parsing
function tolerantParse(text: string): unknown {
  const cleaned = text
    .replace(/\/\/[^\n"]*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(cleaned); } catch { return null; }
}

interface StdioCandidate { name?: string; command: string; args: string[]; env: Record<string, string> }

// Leter etter {"mcpServers": {"navn": {"command": …}}} eller enkeltobjekter med command/args
function findServerInJson(value: unknown, keyHint?: string): StdioCandidate | null {
  if (value == null || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.command === 'string') {
    return {
      name: keyHint,
      command: obj.command,
      args: Array.isArray(obj.args) ? obj.args.map(String) : [],
      env: typeof obj.env === 'object' && obj.env != null
        ? Object.fromEntries(Object.entries(obj.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
        : {},
    };
  }
  for (const key of ['mcpServers', 'servers', ...Object.keys(obj)]) {
    const child = obj[key];
    if (child != null && typeof child === 'object') {
      const found = findServerInJson(child, key === 'mcpServers' || key === 'servers' ? undefined : key);
      if (found) return found;
    }
  }
  return null;
}

function findServerInReadme(readme: string): StdioCandidate | null {
  // Linjeankret parvis matching av ```-fencer — ellers kommer parseren ut av takt
  // når blokker med andre språk (```sh o.l.) ligger foran JSON-blokken
  const blocks = [...readme.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)].map((m) => m[1]);
  const candidates: StdioCandidate[] = [];
  for (const block of blocks) {
    if (!block.includes('"command"')) continue;
    const candidate = findServerInJson(tolerantParse(block));
    if (candidate) candidates.push(candidate);
  }
  // README-er viser ofte både npx- og docker-oppsett — foretrekk det som ikke krever docker
  return candidates.find((c) => ['npx', 'uvx', 'node'].includes(c.command)) ?? candidates[0] ?? null;
}

function envPlaceholders(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([, v]) => /^<.*>$|YOUR|XXX|CHANGE|INSERT|API[-_]?KEY|TOKEN/i.test(v) || v === '')
    .map(([k]) => k);
}

function toResult(candidate: StdioCandidate, fallbackName: string, source: string): McpImportResult {
  const config = {
    transport: 'stdio' as const,
    command: candidate.command,
    args: candidate.args,
    ...(Object.keys(candidate.env).length > 0 ? { env: candidate.env } : {}),
  };
  const missing = envPlaceholders(candidate.env);
  const notes = [`Oppsett hentet fra ${source}.`];
  if (missing.length > 0) notes.push(`Fyll inn verdier for env: ${missing.join(', ')}.`);
  if (!['npx', 'uvx', 'docker', 'node', 'python', 'python3'].includes(candidate.command)) {
    notes.push(`Kommandoen «${candidate.command}» må finnes på serveren.`);
  }
  notes.push('Kontroller innholdet og trykk Opprett, deretter Test på MCP-siden.');
  return {
    name: (candidate.name ?? fallbackName).toLowerCase().replace(/[^a-z0-9æøå_-]+/g, '-'),
    config: JSON.stringify(config, null, 2),
    note: notes.join(' '),
  };
}

async function npmPackageResult(pkg: string): Promise<McpImportResult | null> {
  const meta = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
  if (!meta || typeof meta.name !== 'string') return null;
  const shortName = meta.name.split('/').pop()!.replace(/^(mcp-server-|server-)/, '');
  return toResult(
    { command: 'npx', args: ['-y', meta.name], env: {} },
    shortName,
    `npm-pakken ${meta.name}`
  );
}

export async function importMcpSetup(source: string): Promise<McpImportResult> {
  const input = source.trim();
  if (!input) throw new Error('Oppgi en GitHub-URL eller et npm-pakkenavn.');

  // Rent npm-pakkenavn (f.eks. @modelcontextprotocol/server-filesystem)
  if (!input.includes('://') && !input.includes('github.com')) {
    const result = await npmPackageResult(input);
    if (result) return result;
    throw new Error(`Fant ikke npm-pakken «${input}» — sjekk navnet, eller lim inn GitHub-URL-en.`);
  }

  // GitHub-URL, evt. med undermappe: github.com/eier/repo[/tree/gren/sti/til/server]
  let url: URL;
  try { url = new URL(input.startsWith('http') ? input : `https://${input}`); } catch {
    throw new Error('Ugyldig URL.');
  }
  if (url.hostname !== 'github.com') throw new Error('Kun github.com-URL-er eller npm-pakkenavn støttes.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('URL-en må peke på et repo: github.com/eier/repo');
  const [owner, repo] = parts;
  let branch: string | null = null;
  let subpath = '';
  if (parts[2] === 'tree' || parts[2] === 'blob') {
    branch = parts[3] ?? null;
    subpath = parts.slice(4).join('/');
  }
  if (!branch) {
    const repoMeta = await fetchJson(`https://api.github.com/repos/${owner}/${repo}`);
    branch = (repoMeta?.default_branch as string | undefined) ?? 'main';
  }

  const raw = (p: string) =>
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`.replace(/\/+$/, '');
  const inDir = (f: string) => (subpath ? `${subpath}/${f}` : f);

  // 1) README i undermappen, så i rot-repoet — mest presise kilde (inkluderer args/env)
  for (const readmePath of [inDir('README.md'), 'README.md']) {
    const readme = await fetchText(raw(readmePath));
    if (!readme) continue;
    const candidate = findServerInReadme(readme);
    if (candidate) {
      return toResult(candidate, subpath.split('/').pop() || repo, `README i github.com/${owner}/${repo}`);
    }
  }

  // 2) package.json → publisert npm-pakke kjørt med npx
  const pkg = await fetchJson(raw(inDir('package.json')));
  if (pkg && typeof pkg.name === 'string') {
    const result = await npmPackageResult(pkg.name);
    if (result) return result;
  }

  throw new Error(
    `Fant ingen MCP-konfigurasjon i github.com/${owner}/${repo}` +
    (subpath ? `/${subpath}` : '') +
    ' — sjekk at README-en har en mcpServers-blokk, eller sett opp serveren manuelt.'
  );
}
