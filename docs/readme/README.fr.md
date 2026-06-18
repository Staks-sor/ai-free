# AI Free

## Choisissez votre langue

<p>
  <a href="../../README.md"><img src="https://img.shields.io/badge/Русский-0969da?style=for-the-badge" height="30" alt="Русский"></a>
  <a href="README.en.md"><img src="https://img.shields.io/badge/English-1f883d?style=for-the-badge" height="30" alt="English"></a>
  <a href="README.es.md"><img src="https://img.shields.io/badge/Español-d29922?style=for-the-badge" height="30" alt="Español"></a>
  <a href="README.pt.md"><img src="https://img.shields.io/badge/Português-8250df?style=for-the-badge" height="30" alt="Português"></a>
  <a href="README.de.md"><img src="https://img.shields.io/badge/Deutsch-cf222e?style=for-the-badge" height="30" alt="Deutsch"></a>
  <a href="README.fr.md"><img src="https://img.shields.io/badge/Français-0550ae?style=for-the-badge" height="30" alt="Français"></a>
  <a href="README.zh.md"><img src="https://img.shields.io/badge/中文-b35900?style=for-the-badge" height="30" alt="中文"></a>
  <a href="README.hi.md"><img src="https://img.shields.io/badge/हिन्दी-9a6700?style=for-the-badge" height="30" alt="हिन्दी"></a>
  <a href="README.ar.md"><img src="https://img.shields.io/badge/العربية-1a7f37?style=for-the-badge" height="30" alt="العربية"></a>
</p>

> CLI et application de bureau réunissant des chats web IA gratuits dans une seule interface. Prend actuellement en charge **DeepSeek, Qwen et ChatGPT** sur macOS, Linux et Windows.

## Soutenir le projet

Si AI Free vous fait gagner du temps, [ajoutez une étoile au dépôt](https://github.com/Staks-sor/ai-free). Cela aide d'autres personnes à découvrir le projet.

- Carte de don (OTP Bank) : `2201 9604 2500 7505`

## Fonctionnalités

- DeepSeek, Qwen et ChatGPT dans une même fenêtre.
- Connexion automatique et restauration de session pour chaque fournisseur.
- Plusieurs chats, chacun lié à son propre dossier de projet.
- Agent `/code` avec accès aux fichiers du workspace et commandes autorisées.
- Mémoire à long terme, graphe de mémoire et skills réutilisables.
- API locales compatibles OpenAI et Anthropic pour les IDE.
- Saisie vocale multilingue facultative avec Parakeet V3, téléchargée à la première utilisation.
- Réglages séparés pour la langue, l'API, les autorisations et l'agent.

## Prérequis

- Node.js 18 ou version ultérieure.
- npm.
- Accès à Internet pour les fournisseurs et l'installation initiale de Chromium.

## Installation

### macOS et Linux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

Sous Linux :

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

Au premier lancement, sélectionnez les fournisseurs et connectez-vous dans la fenêtre du navigateur. Les sessions sont conservées localement.

## Commandes principales

| Commande | Fonction |
|---|---|
| `npm start` | Lancer l'application de bureau |
| `npm run cli` | Lancer le REPL du terminal |
| `npm run api` | Lancer l'API locale sur `127.0.0.1:4318` |
| `npm run login` | Reconnecter DeepSeek |
| `npm run login-qwen` | Reconnecter Qwen |
| `npm run login-chatgpt` | Reconnecter ChatGPT |
| `npm test` | Exécuter les tests |

## API locale

```bash
npm run api
```

URL de base compatible OpenAI :

```text
http://127.0.0.1:4318/v1
```

Les clés et options se trouvent dans **Paramètres → API**.

## Projets, mémoire et skills

Lors de la création d'un chat, choisissez un dossier de projet. Les outils de l'agent travaillent uniquement dans ce workspace.

- **Coder** envoie les tâches directement à l'agent.
- **Mémoire** retrouve les solutions précédentes et conserve les résultats utiles.
- **Skill auto** sélectionne automatiquement une skill.
- `/skill <id> <tâche>` sélectionne une skill manuellement.

Architecture détaillée : [Plan mémoire et skills](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md).

## Données locales et sécurité

- DeepSeek et état partagé : `~/.deepseek-cli/`
- Qwen : `~/.qwen-cli/`
- Mémoire et skills : `~/.ai-free/`

Les jetons et cookies restent sur l'ordinateur. Les serveurs écoutent uniquement sur `127.0.0.1`.

## Problèmes et licence

Utilisez la commande `login` correspondante pour reconnecter un fournisseur. Si Chromium manque, exécutez `npx playwright install chromium`.

Un problème ? [Ouvrez une issue](https://github.com/Staks-sor/ai-free/issues).

Usage personnel uniquement. Voir [LICENSE](../../LICENSE).
