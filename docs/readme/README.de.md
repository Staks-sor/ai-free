# AI Free

[<kbd>Русский</kbd>](../../README.md) [<kbd>English</kbd>](README.en.md) [<kbd>Español</kbd>](README.es.md) [<kbd>Português</kbd>](README.pt.md) [<kbd>Deutsch</kbd>](README.de.md) [<kbd>Français</kbd>](README.fr.md) [<kbd>中文</kbd>](README.zh.md) [<kbd>हिन्दी</kbd>](README.hi.md) [<kbd>العربية</kbd>](README.ar.md)

> CLI und Desktop-App für kostenlose KI-Webchats in einer gemeinsamen Oberfläche. Unterstützt derzeit **DeepSeek, Qwen und ChatGPT** unter macOS, Linux und Windows.

## Projekt unterstützen

Wenn AI Free dir Zeit spart, [gib dem Repository einen Stern](https://github.com/Staks-sor/ai-free). So können mehr Menschen das Projekt finden.

- Spendenkarte (OTP Bank): `2201 9604 2500 7505`

## Funktionen

- DeepSeek, Qwen und ChatGPT in einem Desktop-Fenster.
- Automatische Anmeldung und Sitzungswiederherstellung je Anbieter.
- Mehrere Chats mit jeweils eigenem Projektordner.
- `/code`-Agent mit Workspace-Dateizugriff und erlaubten Befehlen.
- Langzeitgedächtnis, Memory Graph und wiederverwendbare Skills.
- Lokale OpenAI- und Anthropic-kompatible APIs für IDEs.
- Optionale mehrsprachige Spracheingabe mit Parakeet V3, Download erst bei der ersten Nutzung.
- Getrennte Einstellungen für Sprache, API, Berechtigungen und Agent.

## Voraussetzungen

- Node.js 18 oder neuer.
- npm.
- Internetzugang für die Anbieter und die erste Chromium-Installation.

## Installation

### macOS und Linux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

Unter Linux:

```bash
sudo npx playwright install-deps chromium
```

### Windows

```powershell
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

Beim ersten Start wählst du die Anbieter aus und meldest dich im Browserfenster an. Sitzungen werden lokal gespeichert.

## Wichtige Befehle

| Befehl | Funktion |
|---|---|
| `npm start` | Desktop-App starten |
| `npm run cli` | Terminal-REPL starten |
| `npm run api` | Lokale API auf `127.0.0.1:4318` starten |
| `npm run login` | DeepSeek erneut verbinden |
| `npm run login-qwen` | Qwen erneut verbinden |
| `npm run login-chatgpt` | ChatGPT erneut verbinden |
| `npm test` | Tests ausführen |

## Lokale API

```bash
npm run api
```

OpenAI-kompatible Basis-URL:

```text
http://127.0.0.1:4318/v1
```

API-Schlüssel und Anbieteroptionen findest du unter **Einstellungen → API**.

## Projekte, Memory und Skills

Beim Erstellen eines Chats wählst du einen Projektordner. Agentenwerkzeuge arbeiten ausschließlich in diesem Workspace.

- **Coder** sendet Aufgaben direkt an den Agenten.
- **Memory** lädt frühere Lösungen und speichert nützliche Ergebnisse.
- **Skill auto** wählt automatisch einen Skill.
- `/skill <id> <aufgabe>` wählt einen Skill manuell.

Architektur: [Memory- und Skills-Plan](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md).

## Lokale Daten und Sicherheit

- DeepSeek und gemeinsamer Chatstatus: `~/.deepseek-cli/`
- Qwen: `~/.qwen-cli/`
- Memory und Skills: `~/.ai-free/`

Tokens und Cookies bleiben auf dem Rechner. Die Server lauschen nur auf `127.0.0.1`.

## Fehler und Lizenz

Verbinde einen Anbieter mit dem passenden `login`-Befehl neu. Fehlt Chromium, führe `npx playwright install chromium` aus.

Fehler gefunden? [Issue erstellen](https://github.com/Staks-sor/ai-free/issues).

Nur für den persönlichen Gebrauch. Siehe [LICENSE](../../LICENSE).
