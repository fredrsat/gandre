# gandre

**Selvhostet agent-plattform for hjemmeserveren.** Sett opp AI-agenter som kjører på
tidsplan — værvarsel om morgenen, «er bussen i rute?» før avgang, prisvakt på
favorittvarene — administrert fra et enkelt web-dashboard, med push-varsling til mobilen
kun når noe faktisk krever oppmerksomhet.

Bygget for én Mac mini og én bruker: én Node-prosess, SQLite, server-rendret HTML uten
byggsteg, og ingenting i skyen du ikke velger selv.

## Funksjoner

- **Fritt modellvalg per agent** — Anthropic (Claude), OpenRouter, eller lokal modell via
  Ollama. API-nøkler i `.env` eller per agent.
- **Grafisk kjøremønster** — manuell, hver time, daglig (alle dager/hverdager/helg),
  ukentlig med dagvalg, månedlig, eller rått cron-uttrykk for spesialtilfeller.
- **MCP-verktøy** — koble agentene til hva som helst som snakker
  [Model Context Protocol](https://modelcontextprotocol.io) (stdio, HTTP eller SSE).
  Serverne registreres én gang, testes med ett klikk, og krysses av per agent.
  Lim inn en GitHub-URL eller et npm-pakkenavn, så utledes oppsettet automatisk.
- **Minne mellom kjøringer** — hver agent har en `memory.md` som sendes med i prompten
  og som agenten oppdaterer selv. En daglig agent vet hva den meldte i går.
- **Varsling via [ntfy](https://ntfy.sh)** — push ved fullført kjøring eller feil.
  Starter agentens sluttsvar med `[STILLE]`, droppes pushen — «varsle kun ved avvik»
  styres rett fra prompten.
- **Full sporbarhet** — hver kjøring lagres med komplett transkript (alle verktøykall
  med argumenter og svar), tokens og estimert kostnad per agent.
- **Robust drift** — planlagte kjøringer får automatisk nye forsøk ved feil,
  overlappende kjøringer hoppes over, og krasj merkes ærlig i historikken.
  Kjører som LaunchDaemon på macOS, styrt med det medfølgende `gandrectl`-skriptet.

## Kom i gang

```sh
git clone https://github.com/fredrsat/gandre.git
cd gandre
npm install
cp .env.example .env    # fyll inn API-nøkler og evt. ntfy-topic
npm run start           # dashboard på http://localhost:3040
```

Full oppskrift for varig drift på en (headless) Mac mini — LaunchDaemon, `gandrectl`,
energiinnstillinger og feilsøking: **[INSTALL.md](INSTALL.md)**.

## Slik virker det

En **agent** er en konfigurasjon:

| Felt | Betydning |
|---|---|
| Kjøremønster | Grafisk valg: manuell, hver time, daglig (alle/hverdager/helg), ukentlig eller månedlig — eller egendefinert cron. Tidssone `GANDRE_TZ`. |
| Leverandør/modell | `anthropic` (claude-opus-5 …), `openrouter` (anthropic/claude-sonnet-5 …), `ollama` (qwen3.5:9b …) |
| System-prompt | Rolle og faste instruksjoner |
| Oppgave-prompt | Selve oppgaven som kjøres hver gang |
| Arbeidsmappe | Datagrunnlaget: agenten leser filer med `list_files`/`read_file`, og skriver med `write_file` hvis tillatt. Minnet (`memory.md`) bor her. |
| MCP-servere | Kryss av hvilke servere fra registeret agenten får bruke |
| Maks steg | Ett steg = én runde mot modellen; verktøybruk koster ett steg per runde. Nødbrems mot løpske agenter. |
| Overstyringer | Valgfritt per agent: API-nøkkel, base-URL (ollama), ntfy-url/-topic/-token. Tomt = verdiene fra `.env`. |

Ved hvert kjøretidspunkt starter plattformen en modell-løkke med agentens verktøy
(filverktøy + `save_memory` + valgte MCP-servere), lagrer transkriptet, og pusher
sluttsvaret til ntfy — med mindre det starter med `[STILLE]`.

### MCP-registeret

Siden **MCP** viser alle verktøyservere plattformen kjenner, med status («Test»-knappen
kobler til og lister verktøyene) og hvilke agenter som bruker hver server.

**Hent oppsett automatisk:** lim inn en GitHub-URL (også undermapper i monorepoer) eller
et npm-pakkenavn. Plattformen leser README/package.json, utleder konfigurasjonen
(npx/uvx foretrekkes fremfor docker), advarer om plassholder-stier og env-nøkler som må
fylles inn, og forhåndsutfyller skjemaet. Ingenting installeres før du lagrer og tester.

Konfigurasjonen per server er JSON:

```json
{ "transport": "stdio", "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/en/mappe"], "env": {} }
```

```json
{ "transport": "http", "url": "https://eksempel.no/mcp",
  "headers": { "Authorization": "Bearer …" } }
```

Tips til norske hjemmeservere: [yr-mcp](https://github.com/fredrsat/yr-mcp) (værdata fra
Yr/MET) og [ruter-connector](https://github.com/fredrsat/ruter-connector) (sanntid for
norsk kollektivtrafikk via Entur) er bygget for akkurat denne plattformen.

### Varsling

Sett `NTFY_TOPIC` i `.env` (topicnavnet er «passordet» på ntfy.sh — velg noe ugjettbart)
og abonner i ntfy-appen. `GANDRE_PUBLIC_URL` gjør varselet klikkbart rett inn til
kjøringen — bruk serverens Tailscale-navn så lenken virker overalt, eller la den stå tom
for ingen lenke. Hver agent kan overstyre url/topic/token og varsle til egne topics.

**Varsle kun ved avvik:** be agenten i prompten begynne sluttsvaret med `[STILLE]` når
alt er normalt — da logges kjøringen som vanlig, men ingen push sendes. Feil varsles
alltid.

**Rut til ulike topics fra prompten:** `[TOPIC:suffiks]` i sluttsvaret starter en
seksjon som pushes til `<NTFY_TOPIC>-<suffiks>` — f.eks. gir `[TOPIC:skole]` med
`NTFY_TOPIC=3b901a74-…` topicet `3b901a74-…-skole`. **Flere markører gir flere push**,
én per seksjon — slik kan én agent sende barnemeldingen til `…-skole-b` og
forelderdelen til `…-skole-f` i samme kjøring. Tekst før første markør (eller svar helt
uten markør) går til agentens/`.env` sitt vanlige topic. Suffikset bygger alltid på
basetopicet fra `.env` (den felles, hemmelige app-id-en) — ntfy-topics er et globalt
navnerom, så suffikset legges alltid på og erstatter aldri. `[STILLE]` først i svaret
dropper alle push. Hver seksjon kuttes til ~300 tegn i pushen; alt lagres i
kjøringsloggen.

### Minne

`memory.md` i arbeidsmappen (maks 20 KB) sendes automatisk med i prompten, og agenten
oppdaterer det med `save_memory`-verktøyet. Vises og kan inspiseres på agentsiden.
Tips: små lokalmodeller trenger gjerne eksplisitt beskjed i prompten om å bruke
`save_memory` — større modeller gjør det av seg selv.

## Drift

- `gandrectl` styrer tjenesten: `install`, `start`, `stop`, `restart`, `status`, `logs`,
  `update` (git pull + npm install + restart). `install` genererer launchd-plisten for
  gjeldende bruker og sti automatisk.
- Feiler en planlagt kjøring, prøves den på nytt inntil 2 ganger (60 s mellomrom);
  feilvarsel sendes først når siste forsøk har feilet. Manuelle kjøringer prøves ikke
  på nytt.
- Samme agent kjører aldri to ganger samtidig. Krasjer prosessen midt i en kjøring,
  merkes den som `interrupted` ved neste oppstart. Kjøringer avbrytes hardt etter
  `GANDRE_RUN_TIMEOUT_MIN` (standard 30 min).
- Kjøringer eldre enn 90 dager slettes automatisk.
- Statistikk per agent (kjøringer, tokens, estimert kostnad siste 30 dager og totalt)
  vises på agentsiden.

## Sikkerhet

Bygget for én bruker på eget LAN — vurder selv før du utvider:

- **Aldri port-forward** UI-et ut på internett. Bruk LAN eller Tailscale.
- Sett `GANDRE_USER`/`GANDRE_PASS` i `.env` for basic auth — anbefalt, siden agenter kan
  skrive filer og MCP-servere kjører vilkårlige kommandoer. `/healthz` er unntatt.
- `GANDRE_BIND=127.0.0.1` begrenser til lokal maskin (f.eks. bak Tailscale serve).
- Filverktøyene er låst til agentens arbeidsmappe (inkl. symlink-sjekk); MCP-servere er
  det ikke — en stdio-server kjører som din bruker, så å konfigurere en er i praksis
  shell-tilgang.
- Per-agent API-nøkler og ntfy-tokens lagres i klartekst i `data/gandre.db` — ikke del
  databasefilen; bruk helst `.env` for nøkler som gjelder alle agenter.
- CSRF-beskyttelse er bevisst utelatt (én bruker, LAN, basic auth).

## Teknologi

Node 22+ · TypeScript (kjørt direkte med tsx, ingen byggsteg) ·
[Vercel AI SDK](https://ai-sdk.dev) med `@ai-sdk/mcp` · better-sqlite3 · croner ·
Hono med server-rendret HTML.

## Lisens

[MIT](LICENSE) © Fredrik Sætre
