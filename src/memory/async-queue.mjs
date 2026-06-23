// Очередь фонового сохранения памяти — один worker, bounded queue, компактные payload.

const MAX_QUEUE = 24;
const MAX_TOOL_LOGS = 32;
const MAX_TOOL_LOG_CHARS = 10_000;
const MAX_TASK_CHARS = 2_000;
const MAX_ASSISTANT_CHARS = 4_000;

let queue = [];
let draining = false;
const stats = { queued: 0, processed: 0, dropped: 0, errors: 0, coalesced: 0 };

export function resetMemoryQueueForTests() {
  queue = [];
  draining = false;
  stats.queued = 0;
  stats.processed = 0;
  stats.dropped = 0;
  stats.errors = 0;
  stats.coalesced = 0;
}

export function getMemoryQueueStats() {
  return {
    pending: queue.length,
    draining,
    ...stats,
  };
}

function jobKey(job) {
  const ws = job.workspaceRoot || "";
  const head = String(job.task || job.userPrompt || "").slice(0, 96);
  return `${job.type}:${ws}:${head}`;
}

function compactToolLogs(toolLogs) {
  const arr = Array.isArray(toolLogs) ? toolLogs.slice(-MAX_TOOL_LOGS) : [];
  const out = [];
  let total = 0;
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const line = String(arr[i]).slice(0, 900);
    if (!line) continue;
    total += line.length;
    if (total > MAX_TOOL_LOG_CHARS) break;
    out.unshift(line);
  }
  return out;
}

function pushJob(job) {
  const key = jobKey(job);
  const existing = queue.findIndex((entry) => jobKey(entry) === key);
  if (existing >= 0) {
    queue[existing] = job;
    stats.coalesced += 1;
    scheduleDrain();
    return true;
  }

  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    stats.dropped += 1;
  }

  queue.push(job);
  stats.queued += 1;
  scheduleDrain();
  return true;
}

function scheduleDrain() {
  if (draining) return;
  setImmediate(() => {
    drain().catch((error) => {
      console.error("[memory-queue] drain failed:", error.message);
    });
  });
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        const result = await processJob(job);
        stats.processed += 1;
        job.onComplete?.(result);
      } catch (error) {
        stats.errors += 1;
        console.error("[memory-queue] job failed:", error.message);
        job.onComplete?.({ count: 0, error: error.message });
      }
    }
  } finally {
    draining = false;
    if (queue.length) scheduleDrain();
  }
}

async function processJob(job) {
  if (job.type === "code-experience") {
    const { extractExperience } = await import("./extractor.mjs");
    const { saveExperience } = await import("./save-experience.mjs");
    const experience = extractExperience(job.task, job.toolLogs);
    const saved = saveExperience({
      task: job.task,
      experience,
      workspaceRoot: job.workspaceRoot,
    });
    return { count: saved.length, type: job.type };
  }

  if (job.type === "chat-turn") {
    const { saveChatTurn } = await import("./chat-save.mjs");
    const item = saveChatTurn(job);
    return { count: item ? 1 : 0, type: job.type };
  }

  return { count: 0, type: job.type || "unknown" };
}

export function enqueueCodeExperienceSave({
  task,
  toolLogs = [],
  workspaceRoot = "",
  onComplete = null,
} = {}) {
  return pushJob({
    type: "code-experience",
    task: String(task || "").slice(0, MAX_TASK_CHARS),
    toolLogs: compactToolLogs(toolLogs),
    workspaceRoot: String(workspaceRoot || ""),
    onComplete,
  });
}

export function enqueueChatTurnSave({
  userPrompt = "",
  assistantText = "",
  workspaceRoot = "",
  onComplete = null,
} = {}) {
  const user = String(userPrompt || "").trim();
  const assistant = String(assistantText || "").trim();
  if (!user && !assistant) return false;

  return pushJob({
    type: "chat-turn",
    userPrompt: user.slice(0, MAX_TASK_CHARS),
    assistantText: assistant.slice(0, MAX_ASSISTANT_CHARS),
    workspaceRoot: String(workspaceRoot || ""),
    onComplete,
  });
}

export async function flushMemoryQueueForTests() {
  while (queue.length || draining) {
    if (!draining && queue.length) scheduleDrain();
    await new Promise((resolve) => setImmediate(resolve));
  }
}
