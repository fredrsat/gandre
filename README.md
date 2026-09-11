# gandre

Enkel, selvhostet agent-plattform for Mac mini. Sett opp agenter med kjøremønster (cron),
modell (Claude, OpenRouter eller lokal Ollama), prompt, datagrunnlag (arbeidsmappe) og
MCP-verktøy — administrert via et web-dashboard på LAN. Hver kjøring logges med fullt
transkript, og ntfy sender push-varsel når en kjøring er ferdig eller feiler.

## Kom i gang

Krever Node 22+ (native `--env-file`, og `ai`-pakken er ESM-only).

```sh
npm install
cp .env.example .env     # fyll inn API-nøkler og evt. ntfy-topic
npm run start            # web-UI på http://localhost:3040
```

Åpne dashboardet, trykk «+ Ny agent», og fyll inn:

| Felt | Betydning |
|---|---|
| Kjøremønster | Grafisk valg: kun manuell, hver time, daglig, ukentlig (velg dager) eller månedlig — eller egendefinert cron-uttrykk. Tidssone `GANDRE_TZ`. |
| Leverandør/modell | `anthropic` (claude-opus-5 …), `openrouter` (anthropic/claude-sonnet-5 …), `ollama` (qwen3.5:9b …) |
| System-prompt | Rolle og faste instruksjoner |
| Oppgave-prompt | Selve oppgaven som kjøres hver gang |
| Arbeidsmappe | Datagrunnlaget: agenten kan lese filer her med `list_files`/`read_file`, og skrive med `write_file` hvis tillatt. Tomt felt = egen mappe under `data/agents/`. |
| MCP-servere | Kryss av hvilke servere fra MCP-registeret agenten får bruke |
| Maks steg | Øvre grense for modell-runder per kjøring. Ett steg = én forespørsel til modellen; hver runde med verktøybruk koster ett steg. Grensen stopper agenter som går i loop. |
| Overstyringer | Valgfritt per agent: API-nøkkel, base-URL (ollama) og ntfy-url/-topic/-token. Tomme felter faller tilbake til verdiene i `.env`. |

Kjør en agent fra terminalen: `npm run once -- <agentnavn>`.

### Minne mellom kjøringer

Hver agent har et vedvarende minne i `memory.md` i arbeidsmappen. Innholdet (maks 20 KB)
sendes automatisk med i prompten ved hver kjøring, og agenten oppdaterer det selv med
`save_memory`-verktøyet — slik vet en daglig agent hva den allerede har rapportert.
Minnet vises på agentsiden i UI-et og kan redigeres direkte i filen ved behov.
Tips: små lokalmodeller kan trenge eksplisitt beskjed i prompten om å bruke `save_memory`.

### MCP-registeret

Siden **MCP** i menyen viser alle verktøyservere plattformen kjenner til, med status
(«Test»-knappen kobler til serveren og lister verktøyene den tilbyr) og hvilke agenter som
bruker hver server. Serverne defineres én gang i registeret og krysses av per agent.

**Hent oppsett automatisk:** lim inn en GitHub-URL (også undermapper i monorepo, f.eks.
`github.com/modelcontextprotocol/servers/tree/main/src/memory`) eller et npm-pakkenavn i
feltet på MCP-siden. Plattformen leser README/package.json, utleder konfigurasjonen
(npx/uvx-oppsett foretrekkes fremfor docker) og forhåndsutfyller skjemaet — ingenting
installeres eller kjøres før du selv lagrer og trykker Test. Env-plassholdere (API-nøkler
o.l.) påpekes så du kan fylle dem inn.

Konfigurasjonen per server er JSON:

```json
{ "transport": "stdio", "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/en/mappe"], "env": {} }
```

```json
{ "transport": "http", "url": "https://eksempel.no/mcp",
  "headers": { "Authorization": "Bearer …" } }
```

`transport` er `stdio` (lokal kommando), `http` eller `sse` (ekstern server).
Merk: en stdio-server kjører som din bruker — å konfigurere en er i praksis det samme som
shell-tilgang. Greit på en én-brukers hjemmeserver, men ikke gi andre tilgang til UI-et.

### Varsling (ntfy)

Sett `NTFY_TOPIC` i `.env` (og evt. `NTFY_URL` for selvhostet server, `NTFY_TOKEN` for auth).
Abonner på topicet i ntfy-appen på mobilen. Topicnavnet er «passordet» på ntfy.sh — velg noe
ugjettbart, f.eks. `gandre-<tilfeldig-streng>`. `GANDRE_PUBLIC_URL` styrer hvor varselets
klikk-lenke peker. Hver agent kan overstyre url/topic/token i sitt eget skjema, så ulike
agenter kan varsle til ulike topics.

## Kjør som tjeneste (launchd)

```sh
cp launchd/no.gandre.server.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.gandre.server.plist
```

Logger havner i `data/logs/out.log` og `err.log`. Stopp med
`launchctl bootout gui/$(id -u)/no.gandre.server`.

På en headless Mac mini: en LaunchAgent kjører bare når brukeren er innlogget — skru på
automatisk innlogging (Systeminnstillinger → Brukere), og hindre at maskinen sover
(Strømsparing, eller `caffeinate`). Cron-tidspunkter som passerer mens maskinen er av/sover
kjøres ikke i etterkant — de hoppes over.

`better-sqlite3` er en native modul: bytter du Node-versjon, kjør `npm rebuild better-sqlite3`.

## Sikkerhet

- UI-et er tenkt for LAN/Tailscale. **Aldri port-forward det ut på internett.**
- Sett `GANDRE_USER`/`GANDRE_PASS` i `.env` for basic auth — anbefalt, siden agenter kan
  skrive filer og MCP-servere kjører vilkårlige kommandoer.
- `GANDRE_BIND=127.0.0.1` begrenser til lokal maskin (f.eks. bak Tailscale serve).
- Filverktøyene er låst til agentens arbeidsmappe (inkl. symlink-sjekk); MCP-servere er det ikke.
- Per-agent API-nøkler og ntfy-tokens lagres i klartekst i `data/gandre.db` — ikke del
  databasefilen, og bruk helst `.env` for nøkler som gjelder alle agenter.
- CSRF-beskyttelse er bevisst utelatt (én bruker, LAN, basic auth).

## Drift

- Kjøringer eldre enn 90 dager slettes automatisk ved oppstart.
- En kjøring avbrytes hardt etter `GANDRE_RUN_TIMEOUT_MIN` (standard 30 min).
- Samme agent kjører aldri to ganger samtidig — kolliderende starter hoppes over.
- Feiler en planlagt kjøring, prøves den automatisk på nytt inntil 2 ganger (60 s mellomrom);
  feilvarsel sendes først når siste forsøk har feilet. Alle forsøk vises i historikken.
  Manuelle kjøringer prøves ikke på nytt — der ser du feilen med en gang.
- Krasjer prosessen midt i en kjøring, merkes den som `interrupted` ved neste oppstart.
