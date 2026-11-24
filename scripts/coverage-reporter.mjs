import path from 'node:path';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COVERAGE_FILES = [
  'src/diagnostics/runtime-metrics.mjs', 'src/providers/qwen/request-pacing.mjs',
  'src/providers/deepseek/response-errors.mjs', 'src/providers/request-budget-store.mjs', 'src/providers/request-cooldown.mjs', 'src/providers/retry-after.mjs',
  'src/state/window-state-store.mjs', 'src/state/state-writer.mjs', 'src/browser/session-pool.mjs',
  'src/agent-team/team-manager.mjs', 'src/agent-team/team-runner.mjs',
  'src/harness/task-state.mjs', 'src/harness/scheduler.mjs',
  'src/harness/errors.mjs', 'src/harness/auto-continue.mjs', 'src/harness/conversation-runner.mjs',
];
export const COVERAGE_THRESHOLDS = { Lines: 80, Branches: 70, Functions: 80 };

export function coverageFailures(summary) {
  const files = new Map((summary?.files || []).map(file => [path.relative(root, file.path).split(path.sep).join('/'), file]));
  const failures = [];
  for (const name of COVERAGE_FILES) {
    const file = files.get(name);
    if (!file) { failures.push(`${name}: missing coverage`); continue; }
    for (const [kind, minimum] of Object.entries(COVERAGE_THRESHOLDS)) {
      const value = file[`covered${kind === 'Branches' ? 'Branch' : kind === 'Functions' ? 'Function' : 'Line'}Percent`];
      if (!Number.isFinite(value) || value < minimum) failures.push(`${name}: ${kind.toLowerCase()} ${value}% < ${minimum}%`);
    }
  }
  return failures;
}

export default async function* report(source) {
  let summary;
  for await (const event of source) {
    if (event.type === 'test:coverage') summary = event.data.summary;
    if (event.type === 'test:fail') yield `FAIL ${event.data.name}: ${inspect(event.data.details?.error, { depth: 4 })}\n`;
    if (event.type === 'test:diagnostic' && event.data.nesting === 0) yield `${event.data.message}\n`;
  }
  for (const file of summary?.files || []) {
    const name = path.relative(root, file.path).split(path.sep).join('/');
    if (COVERAGE_FILES.includes(name)) yield `${name}: lines ${file.coveredLinePercent.toFixed(2)}%, branches ${file.coveredBranchPercent.toFixed(2)}%, functions ${file.coveredFunctionPercent.toFixed(2)}%\n`;
  }
  const failures = coverageFailures(summary);
  if (failures.length) {
    process.exitCode = 1;
    yield `Coverage gate failed:\n${failures.join('\n')}\n`;
  } else yield `Coverage gate passed: ${COVERAGE_FILES.length} critical modules; lines >=80%, branches >=70%, functions >=80%.\n`;
}
