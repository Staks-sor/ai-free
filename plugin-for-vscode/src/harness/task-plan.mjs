const PLAN_LIMIT = 12;
const LABEL_LIMIT = 120;

export function normalizeTaskPlan(value) {
  const steps = value?.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > PLAN_LIMIT) {
    return { ok: false, error: 'A task plan must contain 1–12 steps.' };
  }
  const ids = new Set();
  let active = 0;
  const safeSteps = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object' || Array.isArray(step)
      || typeof step.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(step.id)
      || ids.has(step.id) || typeof step.title !== 'string'
      || !step.title.trim() || step.title.length > LABEL_LIMIT
      || !['pending', 'in_progress', 'completed'].includes(step.status)) {
      return { ok: false, error: 'Each plan step needs a unique id, short title, and valid status.' };
    }
    ids.add(step.id);
    if (step.status === 'in_progress') active += 1;
    safeSteps.push({ id: step.id, title: step.title.trim(), status: step.status });
  }
  if (active > 1) return { ok: false, error: 'A task plan can have at most one in-progress step.' };
  return { ok: true, plan: { steps: safeSteps } };
}

export function getTaskPlanProgress(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  return { total: steps.length, completed: steps.filter(step => step.status === 'completed').length,
    incomplete: steps.some(step => step.status !== 'completed') };
}
