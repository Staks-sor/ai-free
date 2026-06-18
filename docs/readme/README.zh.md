# AI Free

## 选择语言

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

> 将免费 AI 网页聊天集中到一个界面的命令行和桌面应用。目前支持 **DeepSeek、Qwen 和 ChatGPT**，可运行于 macOS、Linux 和 Windows。

## 支持项目

如果 AI Free 为你节省了时间，请为[仓库点星](https://github.com/Staks-sor/ai-free)，这能帮助更多人发现本项目。

- 捐赠银行卡（OTP Bank）：`2201 9604 2500 7505`

## 主要功能

- 在同一个桌面窗口中使用 DeepSeek、Qwen 和 ChatGPT。
- 为每个服务商自动登录并恢复会话。
- 支持多个聊天，每个聊天绑定独立的项目文件夹。
- `/code` 智能体可访问工作区文件并执行允许的命令。
- 长期记忆、记忆图谱和可复用 Skills。
- 为 IDE 提供兼容 OpenAI 和 Anthropic 的本地 API。
- 可选的 Parakeet V3 多语言语音输入，首次使用时才下载。
- 分开的语言、API、权限和智能体设置。

## 系统要求

- Node.js 18 或更高版本。
- npm。
- 连接 AI 服务商及首次安装 Chromium 时需要网络。

## 安装

### macOS 和 Linux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

Linux 还需执行：

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

首次启动时选择需要连接的服务商，并在浏览器窗口中登录。后续将复用保存在本机的会话。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm start` | 启动桌面聊天窗口 |
| `npm run cli` | 启动终端 REPL |
| `npm run api` | 在 `127.0.0.1:4318` 启动本地 API |
| `npm run login` | 重新连接 DeepSeek |
| `npm run login-qwen` | 重新连接 Qwen |
| `npm run login-chatgpt` | 重新连接 ChatGPT |
| `npm test` | 运行测试 |

## 本地 API

```bash
npm run api
```

OpenAI 兼容的基础地址：

```text
http://127.0.0.1:4318/v1
```

API 密钥和服务商选项位于 **设置 → API**。

## 项目、记忆和 Skills

创建聊天时请选择项目文件夹。智能体工具只会在该工作区中操作。

- **Coder** 将任务直接发送给代码智能体。
- **Memory** 查找以往解决方案并保存有价值的结果。
- **Skill auto** 根据任务自动选择 Skill。
- `/skill <id> <任务>` 可手动选择 Skill。

详细架构：[记忆与 Skills 规划](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md)。

## 本地数据与安全

- DeepSeek 和共享聊天状态：`~/.deepseek-cli/`
- Qwen：`~/.qwen-cli/`
- 记忆和用户 Skills：`~/.ai-free/`

令牌和 Cookie 保留在本机。聊天与 API 服务器仅监听 `127.0.0.1`。

## 问题与许可证

使用对应的 `login` 命令重新连接服务商。如果缺少 Chromium，请执行 `npx playwright install chromium`。

发现问题？请[提交 Issue](https://github.com/Staks-sor/ai-free/issues)。

仅限个人使用。参见 [LICENSE](../../LICENSE)。
