// Deterministic command evidence, not a claim that arbitrary product criteria
// are satisfied. Commands use the existing executor policy and run sequentially.
export async function verifyTask(checks, execute) {
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 5) throw new Error('Verification requires 1 to 5 checks');
  for (const check of checks) {
    if (!check || typeof check.cmd !== 'string' || !check.cmd.trim()) throw new Error('Verification check requires cmd');
    if (!Array.isArray(check.args) || check.args.length > 100 || check.args.some(arg => typeof arg !== 'string')) throw new Error('Verification args must be a bounded array of strings');
    if (check.cmd.length > 256 || check.args.some(arg => arg.length > 4096)) throw new Error('Verification command is too large');
  }
  const results = [];
  for (const check of checks) {
    let result;
    try {
      result = await execute({ tool: 'run_command', cmd: check.cmd, args: check.args, timeoutMs: 30_000 });
    } catch (error) {
      // Approval/install requests belong to the existing agent interaction flow.
      if (error.name === 'AbortError' || error.permissionRequest || error.fatal) throw error;
      result = { ok: false, error: error.message };
    }
    results.push({ name: String(check.name || check.cmd).slice(0, 200), cmd: check.cmd,
      args: check.args, ok: result.ok === true && result.status === 0 && !result.timedOut,
      status: result.status ?? null, timedOut: result.timedOut === true,
      stdout: String(result.stdout || '').slice(0, 2000), stderr: String(result.stderr || result.error || '').slice(0, 2000) });
  }
  const passed = results.every(result => result.ok);
  return { ok: passed, verification: passed ? 'passed' : 'failed', checks: results };
}
