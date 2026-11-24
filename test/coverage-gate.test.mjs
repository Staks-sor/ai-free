import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { coverageFailures, COVERAGE_FILES } from '../scripts/coverage-reporter.mjs';

test('coverage gate rejects absent modules and uncovered branches independently', () => {
  const files = COVERAGE_FILES.map(name => ({ path: fileURLToPath(new URL(`../${name}`, import.meta.url)),
    coveredLinePercent: 95, coveredBranchPercent: 95, coveredFunctionPercent: 95 }));
  assert.deepEqual(coverageFailures({ files }), []);
  files[0].coveredBranchPercent = 69;
  assert.match(coverageFailures({ files })[0], /branches 69% < 70%/);
  files.shift(); assert.match(coverageFailures({ files })[0], /missing coverage/);
  assert.equal(coverageFailures(undefined).length, COVERAGE_FILES.length);
});

test('the real reporter consumes test events and exits nonzero when coverage is missing', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synvox-coverage-gate-'));
  try {
    const fixture = path.join(root, 'one.test.mjs');
    fs.writeFileSync(fixture, "import { test } from 'node:test'; test('one', () => {});\n");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, ['--test', '--experimental-test-coverage',
      `--test-reporter=${fileURLToPath(new URL('../scripts/coverage-reporter.mjs', import.meta.url))}`, fixture],
      { encoding: 'utf8', timeout: 10000, env });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /tests 1/);
    assert.match(result.stdout, /Coverage gate failed/);
    assert.match(result.stdout, /missing coverage/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
