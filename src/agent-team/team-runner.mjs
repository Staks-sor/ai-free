export async function runTeamTasks(tasks = []) {
  return Promise.all(
    tasks.map(async (task) => {
      try {
        const output = await task.run();
        return {
          id: task.id,
          status: "success",
          output,
        };
      } catch (error) {
        return {
          id: task.id,
          status: "failed",
          error: error.message,
        };
      }
    }),
  );
}

export async function runTeamAgents(agents = [], executor) {
  return runTeamTasks(
    agents.map((agent) => ({
      id: agent.id,
      run: () => executor(agent),
    })),
  );
}
