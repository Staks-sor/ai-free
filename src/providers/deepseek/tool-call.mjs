// DeepSeek can emit its native DSML envelope instead of workspace JSON.
export function parseDeepSeekDsml(text) {
  const raw = String(text || "").trim();
  if (!/<\/?\s*[｜|]+\s*DSML\s*[｜|]+/.test(raw)) return null;
  const normalized = raw.replace(/<(\/?)\s*[｜|]+\s*DSML\s*[｜|]+\s*/g, "<$1");
  const envelope = /^<(calls|function_calls)>\s*([\s\S]*?)\s*<\/\1>$/.exec(normalized);
  const invalid = () => new Error("DeepSeek прислал некорректный DSML: ожидается один вызов инструмента с корректными параметрами.");
  if (!envelope) throw invalid();
  const invoke = /^<invoke\s+([^>]+)>([\s\S]*?)<\/invoke>$/.exec(envelope[2]);
  if (!invoke || (envelope[2].match(/<invoke\b/g) || []).length !== 1) throw invalid();
  const attribute = (source, name) => new RegExp(`\\b${name}=["']([^"']*)["']`).exec(source)?.[1];
  const tool = attribute(invoke[1], "name");
  if (!tool || !/^[a-z_]+$/.test(tool)) throw invalid();
  const parameters = Object.create(null);
  const parameterPattern = /<parameter\s+([^>]+)>([\s\S]*?)<\/parameter>/g;
  for (const match of invoke[2].matchAll(parameterPattern)) {
    const name = attribute(match[1], "name");
    const string = attribute(match[1], "string") ?? "true";
    if (!name || !/^[A-Za-z_]\w*$/.test(name) || name === "tool" || Object.hasOwn(parameters, name)
      || !["true", "false"].includes(string)) throw invalid();
    try {
      parameters[name] = string === "true" ? match[2] : JSON.parse(match[2]);
    } catch {
      throw invalid();
    }
  }
  if (invoke[2].replace(parameterPattern, "").trim()) throw invalid();
  return { tool, ...parameters };
}
