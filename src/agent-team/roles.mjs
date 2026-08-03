export const TEAM_ROLES = {
  developer: {
    id: "developer",
    label: "Developer",
    prompt: "Create practical technical solutions, implementation steps and risks.",
  },
  critic: {
    id: "critic",
    label: "Critic",
    prompt: "Review proposals, find weaknesses and suggest improvements.",
  },
  researcher: {
    id: "researcher",
    label: "Researcher",
    prompt: "Analyze information and prepare structured findings.",
  },
  product: {
    id: "product",
    label: "Product",
    prompt: "Evaluate user value, product decisions and tradeoffs.",
  },
};

export function getTeamRole(id) {
  return TEAM_ROLES[id] || TEAM_ROLES.developer;
}
