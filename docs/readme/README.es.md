<h1 align="center">AI Free</h1>

<p align="center">
  <strong>Chats de IA gratuitos, agente de código, memoria y API locales en una sola aplicación</strong>
</p>

## 🌍 Elige tu idioma

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

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/Staks-sor/ai-free?style=flat-square&amp;label=versión" alt="Versión">
  <img src="https://img.shields.io/badge/plataformas-macOS%20%7C%20Linux%20%7C%20Windows-8250df?style=flat-square" alt="macOS, Linux, Windows">
  <img src="https://img.shields.io/badge/Node.js-18%2B-1f883d?style=flat-square" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/proveedores-DeepSeek%20%7C%20Qwen%20%7C%20ChatGPT-d29922?style=flat-square" alt="DeepSeek, Qwen, ChatGPT">
</p>

> CLI y aplicación de escritorio que reúne chats web de IA gratuitos en una sola interfaz. Actualmente admite **DeepSeek, Qwen y ChatGPT** en macOS, Linux y Windows.

## ⭐ Apoya el proyecto

Si AI Free te resulta útil, [añade una estrella al repositorio](https://github.com/Staks-sor/ai-free). Así ayudas a que más personas lo encuentren.

- Tarjeta para donaciones (OTP Bank): `2201 9604 2500 7505`

## ✨ Funciones

- 💬 **Una sola interfaz:** DeepSeek, Qwen y ChatGPT en una ventana.
- 🔑 **Acceso sencillo:** inicio automático y recuperación de sesión por proveedor.
- 📁 **Proyectos separados:** cada chat puede usar su propia carpeta.
- 🛠️ **Agente de código:** acceso al workspace con comandos controlados.
- 🧠 **Memoria y skills:** contexto a largo plazo y flujos reutilizables.
- 🔌 **API locales:** compatibilidad con OpenAI y Anthropic para IDE.
- 🎙️ **Entrada de voz:** Parakeet V3 multilingüe se descarga solo al primer uso.
- ⚙️ **Configuración completa:** idioma, API, permisos y agente.

## 📋 Requisitos

- Node.js 18 o posterior.
- npm.
- Internet para los proveedores y la instalación inicial de Chromium.

## 🚀 Instalación

### macOS y Linux

```bash
git clone https://github.com/Staks-sor/ai-free.git
cd ai-free
npm install
npm start
```

En Linux:

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

En el primer inicio, selecciona los proveedores y accede desde la ventana del navegador. Las sesiones se guardan localmente.

## ⌨️ Comandos principales

| Comando | Función |
|---|---|
| `npm start` | Inicia la aplicación de escritorio |
| `npm run cli` | Inicia el REPL de terminal |
| `npm run api` | Inicia la API local en `127.0.0.1:4318` |
| `npm run login` | Vuelve a conectar DeepSeek |
| `npm run login-qwen` | Vuelve a conectar Qwen |
| `npm run login-chatgpt` | Vuelve a conectar ChatGPT |
| `npm test` | Ejecuta las pruebas |

## 🔌 API local

```bash
npm run api
```

URL base compatible con OpenAI:

```text
http://127.0.0.1:4318/v1
```

Las claves y opciones de cada proveedor están en **Configuración → API**.

## 🧠 Proyectos, memoria y skills

Al crear un chat, selecciona una carpeta de proyecto. Las herramientas del agente trabajan solo dentro de ese workspace.

- **Coder** envía las tareas directamente al agente.
- **Memoria** recupera soluciones anteriores y guarda resultados útiles.
- **Skill auto** elige automáticamente una skill.
- `/skill <id> <tarea>` selecciona una skill manualmente.

Arquitectura detallada: [Plan de memoria y skills](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md).

## 🔒 Datos locales y seguridad

- DeepSeek y estado compartido: `~/.deepseek-cli/`
- Qwen: `~/.qwen-cli/`
- Memoria y skills: `~/.ai-free/`

Los tokens y cookies permanecen en el equipo. Los servidores escuchan únicamente en `127.0.0.1`.

## 🧰 Problemas y licencia

Para volver a conectar un proveedor, usa su comando `login`. Si falta Chromium, ejecuta `npx playwright install chromium`.

¿Encontraste un error? [Abre un issue](https://github.com/Staks-sor/ai-free/issues).

Solo para uso personal. Consulta [LICENSE](../../LICENSE).
