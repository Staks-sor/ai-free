# AI Free

[<kbd>Русский</kbd>](../../README.md) [<kbd>English</kbd>](README.en.md) [<kbd>Español</kbd>](README.es.md) [<kbd>Português</kbd>](README.pt.md) [<kbd>Deutsch</kbd>](README.de.md) [<kbd>Français</kbd>](README.fr.md) [<kbd>中文</kbd>](README.zh.md) [<kbd>हिन्दी</kbd>](README.hi.md) [<kbd>العربية</kbd>](README.ar.md)

> CLI e aplicativo desktop que reúne chats web gratuitos de IA em uma única interface. Atualmente oferece **DeepSeek, Qwen e ChatGPT** para macOS, Linux e Windows.

## Apoie o projeto

Se o AI Free for útil, [dê uma estrela ao repositório](https://github.com/Staks-sor/ai-free). Isso ajuda outras pessoas a encontrarem o projeto.

- Cartão para doações (OTP Bank): `2201 9604 2500 7505`

## Recursos

- DeepSeek, Qwen e ChatGPT em uma única janela.
- Login automático e recuperação de sessão para cada provedor.
- Vários chats, cada um ligado à sua própria pasta de projeto.
- Agente `/code` com acesso aos arquivos do workspace e comandos permitidos.
- Memória de longo prazo, grafo de memória e skills reutilizáveis.
- APIs locais compatíveis com OpenAI e Anthropic para IDEs.
- Entrada de voz multilíngue opcional com Parakeet V3, baixada somente no primeiro uso.
- Configurações separadas de idioma, API, permissões e agente.

## Requisitos

- Node.js 18 ou mais recente.
- npm.
- Internet para os provedores e para a instalação inicial do Chromium.

## Instalação

### macOS e Linux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

No Linux:

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

Na primeira execução, escolha os provedores e faça login na janela do navegador. As sessões ficam salvas localmente.

## Comandos principais

| Comando | Função |
|---|---|
| `npm start` | Inicia o aplicativo desktop |
| `npm run cli` | Inicia o REPL no terminal |
| `npm run api` | Inicia a API local em `127.0.0.1:4318` |
| `npm run login` | Reconecta o DeepSeek |
| `npm run login-qwen` | Reconecta o Qwen |
| `npm run login-chatgpt` | Reconecta o ChatGPT |
| `npm test` | Executa os testes |

## API local

```bash
npm run api
```

URL base compatível com OpenAI:

```text
http://127.0.0.1:4318/v1
```

As chaves e opções dos provedores ficam em **Configurações → API**.

## Projetos, memória e skills

Ao criar um chat, escolha uma pasta de projeto. As ferramentas do agente funcionam somente dentro desse workspace.

- **Coder** envia tarefas diretamente ao agente.
- **Memória** recupera soluções anteriores e salva resultados úteis.
- **Skill auto** seleciona uma skill automaticamente.
- `/skill <id> <tarefa>` seleciona uma skill manualmente.

Arquitetura detalhada: [Plano de memória e skills](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md).

## Dados locais e segurança

- DeepSeek e estado compartilhado: `~/.deepseek-cli/`
- Qwen: `~/.qwen-cli/`
- Memória e skills: `~/.ai-free/`

Tokens e cookies permanecem no computador. Os servidores escutam somente em `127.0.0.1`.

## Problemas e licença

Use o comando `login` correspondente para reconectar um provedor. Se o Chromium estiver ausente, execute `npx playwright install chromium`.

Encontrou um problema? [Abra uma issue](https://github.com/Staks-sor/ai-free/issues).

Somente para uso pessoal. Consulte [LICENSE](../../LICENSE).
