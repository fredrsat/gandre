# Installasjon på Mac (mini)

Fra null til kjørende tjeneste. Alt gjøres i Terminal på maskinen som skal være server.

## 1. Forutsetninger

```sh
# Homebrew (hopp over hvis installert)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node 22+
brew install node
```

Repoet er privat og hentes over SSH — kopier den eksisterende GitHub-nøkkelen til
maskinen (eller legg til en ny på github.com → Settings → SSH keys), og sjekk at den
virker:

```sh
ssh -T git@github.com     # skal svare «Hi fredrsat! …»
```

## 2. Ollama — valgfritt, for lokale modeller

```sh
brew install ollama
brew services start ollama          # starter automatisk ved oppstart
ollama pull qwen3.5:9b              # en modell som kan bruke verktøy
```

## 3. Hent og installer gandre

```sh
mkdir -p ~/Code && cd ~/Code
git clone git@github.com:fredrsat/gandre.git
cd gandre
npm install
```

## 4. Konfigurasjon

```sh
cp .env.example .env
open -e .env
```

Fyll inn minst:

- `ANTHROPIC_API_KEY` og/eller `OPENROUTER_API_KEY` (kan også settes per agent i UI-et)
- `NTFY_TOPIC` — velg noe ugjettbart, f.eks. `gandre-h7fk2m9x`, og abonner på samme
  topic i ntfy-appen på mobilen
- `GANDRE_PUBLIC_URL` — adressen andre enheter når serveren på, f.eks.
  `http://<maskinnavn>.local:3040` (finn navnet med `hostname`)
- `GANDRE_USER` / `GANDRE_PASS` — anbefalt: passordbeskytter UI-et på nettverket

## 5. Prøvekjør

```sh
npm run start
```

Åpne http://localhost:3040 — opprett en agent og trykk «Kjør nå». Stopp med Ctrl-C når
det virker.

## 6. Installer som tjeneste (starter selv, restarter ved krasj)

**Kjører du som en annen bruker enn `fredrsat`, eller klonet til en annen sti:** åpne
`launchd/no.gandre.server.plist` og rett de tre stiene (`WorkingDirectory` og de to
loggstiene) før du fortsetter.

```sh
cp launchd/no.gandre.server.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.gandre.server.plist

# Sjekk at den kjører
curl http://localhost:3040/healthz     # skal svare «ok»
```

Logger: `data/logs/out.log` og `data/logs/err.log`.
Stopp/start: `launchctl bootout gui/$(id -u)/no.gandre.server` og `bootstrap` igjen.

## 7. Serverinnstillinger på en headless Mac mini

- **Automatisk innlogging**: Systeminnstillinger → Brukere og grupper → Logg inn
  automatisk. (En LaunchAgent kjører bare mens brukeren er innlogget.)
- **Hindre søvn**: Systeminnstillinger → Energi → skru av «Sett harddisker i dvale» /
  aktiver «Start automatisk etter strømbrudd», og sett maskinen til aldri å sove.
  Cron-tidspunkter som passerer mens maskinen sover, kjøres ikke i etterkant.
- **Aldri port-forward** UI-et ut på internett — bruk LAN eller Tailscale.

## 8. Oppdatere til ny versjon

```sh
cd ~/Code/gandre
git pull
npm install
launchctl kickstart -k gui/$(id -u)/no.gandre.server   # restarter tjenesten
```

## Feilsøking

| Symptom | Løsning |
|---|---|
| Tjenesten starter ikke etter Node-oppgradering | `npm rebuild better-sqlite3` (native modul) |
| `healthz` svarer ikke | Se `data/logs/err.log`; sjekk at port 3040 er ledig: `lsof -i :3040` |
| Ollama-agent feiler | Kjører Ollama? `curl http://127.0.0.1:11434/api/tags` |
| Ingen push-varsler | Er `NTFY_TOPIC` satt både i `.env` og i ntfy-appen? |
