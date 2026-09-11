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
nano .env          # Ctrl-O lagrer, Ctrl-X avslutter
```

(`nano` fungerer også over SSH — GUI-editorer via `open` gjør ikke det.)

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

## 6. Installer som tjeneste

**På en headless server: bruk LaunchDaemon-varianten (6a).** Den starter ved boot uten at
noen er innlogget, og kan styres helt over SSH. LaunchAgent-varianten (6b) passer bare på
en maskin der brukeren alltid er innlogget grafisk.

**Kjører du som en annen bruker enn `fredrsat`, eller klonet til en annen sti:** rett
stiene og `UserName` i plist-filen før du fortsetter.

### 6a. LaunchDaemon (headless — anbefalt for server)

```sh
# Fjern evt. LaunchAgent-variant fra tidligere forsøk
launchctl bootout gui/$(id -u)/no.gandre.server 2>/dev/null
rm -f ~/Library/LaunchAgents/no.gandre.server.plist

sudo cp launchd/no.gandre.daemon.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/no.gandre.daemon.plist
sudo chmod 644 /Library/LaunchDaemons/no.gandre.daemon.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/no.gandre.daemon.plist

curl http://localhost:3040/healthz     # skal svare «ok»
```

Tjenesten kjører som din bruker (`UserName` i plisten), ikke root.
Restart: `sudo launchctl kickstart -k system/no.gandre.server`
Stopp: `sudo launchctl bootout system/no.gandre.server`

### 6b. LaunchAgent (krever innlogget bruker)

```sh
cp launchd/no.gandre.server.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/no.gandre.server.plist
```

Logger for begge varianter: `data/logs/out.log` og `data/logs/err.log`.

## 7. Serverinnstillinger på en headless Mac mini

```sh
# Aldri søvn + automatisk omstart etter strømbrudd/krasj
sudo pmset -a sleep 0 displaysleep 0 autorestart 1
```

- **FileVault må være av** (eller vent-på-passord ved boot deaktivert) — ellers står
  maskinen på passordskjermen etter strømbrudd og ingenting starter.
- Cron-tidspunkter som passerer mens maskinen er av, kjøres ikke i etterkant.
- **Aldri port-forward** UI-et ut på internett — bruk LAN eller Tailscale.

## 8. Oppdatere til ny versjon

```sh
cd ~/Code/gandre
git pull
npm install
sudo launchctl kickstart -k system/no.gandre.server    # daemon-variant (6a)
# launchctl kickstart -k gui/$(id -u)/no.gandre.server # agent-variant (6b)
```

(Alternativt: `pkill -f "tsx src/index.ts"` — KeepAlive starter tjenesten på nytt
med ny kode, uansett variant.)

## Feilsøking

| Symptom | Løsning |
|---|---|
| Tjenesten starter ikke etter Node-oppgradering | `npm rebuild better-sqlite3` (native modul) |
| `healthz` svarer ikke | Se `data/logs/err.log`; sjekk at port 3040 er ledig: `lsof -i :3040` |
| Ollama-agent feiler | Kjører Ollama? `curl http://127.0.0.1:11434/api/tags` |
| Ingen push-varsler | Er `NTFY_TOPIC` satt både i `.env` og i ntfy-appen? |
