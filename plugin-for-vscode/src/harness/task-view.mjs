// Safe, bounded UI projection. Keep this function standalone: ui-html embeds it.
export function getHarnessTaskView(conversation, { running = false } = {}) {
  const task = conversation?.harnessTask;
  if (!task?.id) return null;
  const busy = running || ['created', 'queued', 'running'].includes(task.status) || Boolean(task.nextResumeAt);
  const reviewRequired = task.checkpoint?.phase === 'executing_tool' || task.failure?.delivery === 'unknown'
    || (task.checkpoint?.phase === 'awaiting_model' && !['not_sent', 'rejected'].includes(task.failure?.delivery));
  const canRecoverModel = conversation.provider === 'qwen' && task.checkpoint?.phase === 'awaiting_model'
    && Boolean(task.checkpoint.prompt) && ['cancelled', 'interrupted'].includes(task.status);
  const accountId = conversation.providerAccountId || conversation.qwenCodeAccountId || (conversation.provider === 'qwen' ? null : 'default');
  const contextChanged = task.provider !== (conversation.provider || 'deepseek') || task.workspace !== conversation.workspace
    || (task.accountId && task.accountId !== accountId)
    || (task.model && conversation.model && task.model !== conversation.model);
  const checks = task.verification !== 'not_run' && Array.isArray(task.verificationChecks)
    ? task.verificationChecks.slice(0, 5).map(check => ({ name: String(check.name || check.cmd || 'check').slice(0, 100),
      ok: check.ok === true && check.status === 0 && !check.timedOut, status: Number.isInteger(check.status) ? check.status : null,
      timedOut: check.timedOut === true })) : [];
  const verification = task.verification === 'not_run' ? 'not_run'
    : task.verification === 'failed' || checks.some(check => !check.ok) ? 'failed'
      : task.verification === 'passed' && checks.length ? 'passed' : 'not_run';
  const canResume = ['paused', 'interrupted', 'failed', 'cancelled'].includes(task.status)
    && Boolean(task.checkpoint) && !busy && (!reviewRequired || canRecoverModel) && !contextChanged;
  const rawSteps = task.plan?.steps;
  const plan = Array.isArray(rawSteps) && rawSteps.length >= 1 && rawSteps.length <= 12
    && rawSteps.every(step => step && typeof step.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(step.id)
      && typeof step.title === 'string' && step.title.trim().length > 0 && step.title.length <= 120
      && ['pending', 'in_progress', 'completed'].includes(step.status))
    && new Set(rawSteps.map(step => step.id)).size === rawSteps.length
    && rawSteps.filter(step => step.status === 'in_progress').length <= 1
    ? rawSteps.map(({ id, title, status }) => ({ id, title: title.trim(), status })) : [];
  const phase = ['awaiting_model', 'executing_tool', 'ready'].includes(task.checkpoint?.phase) ? task.checkpoint.phase : null;
  const tool = task.checkpoint?.pendingAction?.tool;
  const knownTools = new Set(['verify_task', 'update_plan', 'list_skills', 'load_skill', 'read_skill_resource', 'list_files', 'read_file', 'write_file', 'append_file', 'delete_file', 'delete_dir', 'mkdir', 'run_command', 'run_shell', 'ask_user', 'finish', 'computer_snapshot', 'computer_click', 'computer_move', 'computer_drag', 'computer_type', 'computer_key', 'computer_scroll', 'browser_snapshot', 'browser_navigate', 'browser_click', 'browser_type', 'browser_key', 'browser_scroll', 'browser_wait', 'browser_go_back', 'browser_list_tabs', 'browser_switch_tab', 'browser_reset']);
  const currentTool = phase === 'executing_tool' && knownTools.has(tool) ? tool : null;
  return { id: task.id, status: task.status, goal: String(task.goal || '').slice(0, 300), verification, checks,
    plan, phase, currentTool,
    changedFiles: Array.isArray(task.changedFiles) ? task.changedFiles.slice(0, 30).map(file => String(file).slice(0, 200)) : [],
    nextResumeAt: task.nextResumeAt || null, canStop: busy, canResume, reviewRequired: Boolean(reviewRequired),
    resumeReason: busy ? 'busy' : reviewRequired ? 'review_required' : contextChanged ? 'context_changed' : canResume ? null : 'no_checkpoint' };
}

export function assertTaskContinuation(conversation, taskId, options) {
  const view = getHarnessTaskView(conversation, options);
  if (!view || view.id !== taskId) throw Object.assign(new Error('Задача изменилась. Обновите список перед продолжением.'), { status: 409 });
  if (!view.canResume) throw Object.assign(new Error(view.reviewRequired
    ? 'Проверьте результат прерванного действия перед продолжением.'
    : 'Продолжение недоступно: задача выполняется, контекст изменён или нет checkpoint.'), { status: 409 });
}
