import { createFileLogger } from "../logging/logger.mjs";

const teamLogger = createFileLogger({ component: "agent-team" });

export function createTeamConfig({ leader = null, agents = [] } = {}) {
  return normalizeTeamConfig({
    enabled: true,
    leader,
    agents,
  });
}

export function normalizeTeamConfig(config = {}) {
  const warnings = [];
  const agents = Array.isArray(config.agents)
    ? config.agents
        .filter((agent, index) => {
          if (agent && agent.id && agent.provider) return true;
          const warning = { index, reason: "Agent requires id and provider" };
          warnings.push(warning);
          teamLogger.warn("team.agent.discarded", warning);
          return false;
        })
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
    warnings,
  };
}

export function getTeamAgents(config) {
  return normalizeTeamConfig(config).agents;
}
