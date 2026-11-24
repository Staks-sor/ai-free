export async function runTeamTasks(tasks = [], { concurrency = 2 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('concurrency must be a positive integer');
  }
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      try {
        results[index] = { id: task.id, status: 'success', output: await task.run() };
      } catch (error) {
        results[index] = { id: task.id, status: 'failed',
          error: { message: error?.message || String(error), stack: error?.stack || null } };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

export async function runTeamAgents(agents = [], executor, options = {}) {
  return runTeamTasks(agents.map(agent => ({ id: agent.id, run: () => executor(agent) })), options);
}
