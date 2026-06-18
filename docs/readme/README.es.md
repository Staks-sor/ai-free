# AI Free

[<kbd>Русский</kbd>](../../README.md) [<kbd>English</kbd>](README.en.md) [<kbd>Español</kbd>](README.es.md) [<kbd>Português</kbd>](README.pt.md) [<kbd>Deutsch</kbd>](README.de.md) [<kbd>Français</kbd>](README.fr.md) [<kbd>中文</kbd>](README.zh.md) [<kbd>हिन्दी</kbd>](README.hi.md) [<kbd>العربية</kbd>](README.ar.md)

> CLI y aplicación de escritorio que reúne chats web de IA gratuitos en una sola interfaz. Actualmente admite **DeepSeek, Qwen y ChatGPT** en macOS, Linux y Windows.

## Apoya el proyecto

Si AI Free te resulta útil, [añade una estrella al repositorio](https://github.com/Staks-sor/ai-free). Así ayudas a que más personas lo encuentren.

- Tarjeta para donaciones (OTP Bank): `2201 9604 2500 7505`

## Funciones

- Conversaciones de DeepSeek, Qwen y ChatGPT en una sola ventana.
- Inicio de sesión automático y recuperación de sesión por proveedor.
- Varios chats, cada uno vinculado a su propia carpeta de proyecto.
- Agente `/code` con acceso a los archivos del workspace y comandos permitidos.
- Memoria de largo plazo, grafo de memoria y skills reutilizables.
- API locales compatibles con OpenAI y Anthropic para IDE.
- Entrada de voz multilingüe opcional con Parakeet V3, descargada al usarla por primera vez.
- Ajustes independientes de idioma, API, permisos y agente.

## Requisitos

- Node.js 18 o posterior.
- npm.
- Internet para los proveedores y la instalación inicial de Chromium.

## Instalación

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

## Comandos principales

| Comando | Función |
|---|---|
| `npm start` | Inicia la aplicación de escritorio |
| `npm run cli` | Inicia el REPL de terminal |
| `npm run api` | Inicia la API local en `127.0.0.1:4318` |
| `npm run login` | Vuelve a conectar DeepSeek |
| `npm run login-qwen` | Vuelve a conectar Qwen |
| `npm run login-chatgpt` | Vuelve a conectar ChatGPT |
| `npm test` | Ejecuta las pruebas |

## API local

```bash
npm run api
```

URL base compatible con OpenAI:

```text
http://127.0.0.1:4318/v1
```

Las claves y opciones de cada proveedor están en **Configuración → API**.

## Proyectos, memoria y skills

Al crear un chat, selecciona una carpeta de proyecto. Las herramientas del agente trabajan solo dentro de ese workspace.

- **Coder** envía las tareas directamente al agente.
- **Memoria** recupera soluciones anteriores y guarda resultados útiles.
- **Skill auto** elige automáticamente una skill.
- `/skill <id> <tarea>` selecciona una skill manualmente.

Arquitectura detallada: [Plan de memoria y skills](../AI_FREE_BRAINS_AND_SKILLS_PLAN.md).

## Datos locales y seguridad

- DeepSeek y estado compartido: `~/.deepseek-cli/`
- Qwen: `~/.qwen-cli/`
- Memoria y skills: `~/.ai-free/`

Los tokens y cookies permanecen en el equipo. Los servidores escuchan únicamente en `127.0.0.1`.

## Problemas y licencia

Para volver a conectar un proveedor, usa su comando `login`. Si falta Chromium, ejecuta `npx playwright install chromium`.

¿Encontraste un error? [Abre un issue](https://github.com/Staks-sor/ai-free/issues).

Solo para uso personal. Consulta [LICENSE](../../LICENSE).
