export function createTeamConfig({ leader = null, agents = [] } = {}) {
  return normalizeTeamConfig({
    enabled: true,
    leader,
    agents,
  });
}

export function normalizeTeamConfig(config = {}) {
  const agents = Array.isArray(config.agents)
    ? config.agents
        .filter((agent) => agent && agent.id && agent.provider)
        .map((agent) => ({
          id: String(agent.id),
          provider: String(agent.provider),
          model: agent.model ? String(agent.model) : null,
          role: String(agent.role || "assistant"),
        }))
    : [];

  const leader = config.leader && config.leader.provider
    ? {
        provider: String(config.leader.provider),
        model: config.leader.model ? String(config.leader.model) : null,
      }
    : null;

  return {
    enabled: config.enabled === true,
    leader,
    agents,
  };
}

export function getTeamAgents(config) {
  return normalizeTeamConfig(config).agents;
}
