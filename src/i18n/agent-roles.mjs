import { AGENT_ROLES } from "../agent-runtime/roles.mjs";
import { createTranslator } from "./index.mjs";

export function getLocalizedAgentRoles(languageCode = "") {
  const { t } = createTranslator(languageCode);
  return AGENT_ROLES.map((role) => ({
    ...role,
    label: t(`role.${role.id}.label`),
    description: t(`role.${role.id}.description`),
  }));
}
