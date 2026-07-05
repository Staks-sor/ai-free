# AI Free Skills System

## Поддерживаемые форматы плагинов

### 1. AI Free Native Format
 

**skill.json:**
 

### 2. Codex Plugin Format
 

**codex.yaml:**
 

### 3. Claude Code Format
 

## Установка из магазинов

### GitHub
 

### npm registry (для JS-скиллов)
 

### Прямая загрузка
 

## API использования

 

## Интеграция с code-agent

В `src/code-agent/prompt.mjs` добавить:

 

## Безопасность

- Скиллы НЕ выполняют код автоматически
- Все команды проходят через whitelist в settings.json
- Скиллы только добавляют инструкции в prompt
- Нет доступа к файловой системе вне workspace
