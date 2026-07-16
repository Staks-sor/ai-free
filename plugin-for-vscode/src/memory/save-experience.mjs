// Сохранение одной структурированной experience-записи после code-agent run.

import { createHash } from "node:crypto";
import { addMemory } from "./store.mjs";
import { linkExperienceToGraph } from "./graph/linker.mjs";

const DEDUP_WINDOW_MS = 10 * 60 * 1000;
const GENERIC_INSIGHTS = new Set([
  "execution completed successfully",
  "execution finished with errors",
  "completed",
]);

export function normalizeTaskText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._/-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function experienceId(task, workspace, timestamp) {
  const bucket = Math.floor(Number(timestamp || Date.now()) / DEDUP_WINDOW_MS);
  const key = `${workspace}\n${normalizeTaskText(task)}\n${bucket}`;
  return `experience-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function clean(value) {
  return String(value || "").trim();
}

function firstError(errors) {
  return clean(errors[0]?.message || errors[0]?.error);
}

export function saveExperience({ task, experience, workspaceRoot = "", workspace = "" }) {
  if (!experience) return [];

  const targetWorkspace = String(workspaceRoot || workspace || "");
  const files = Array.isArray(experience.files) ? [...new Set(experience.files.map(String).filter(Boolean))] : [];
  const errors = Array.isArray(experience.errors) ? experience.errors.filter(Boolean) : [];
  const steps = Number(experience.summary?.steps || experience.actions?.length || 0);
  const insight = clean(experience.summary?.insight);
  const usefulInsight = insight && !GENERIC_INSIGHTS.has(insight.toLowerCase()) ? insight : "";

  // Не засоряем память задачами, в которых ничего полезного не произошло.
  if (steps === 0 && files.length === 0 && errors.length === 0 && !usefulInsight) return [];

  const problem = clean(experience.problem) || clean(task);
  const rootCause = clean(experience.rootCause) || firstError(errors);
  const failedApproach = clean(experience.failedApproach);
  const verifiedFix = clean(experience.verifiedFix) || (!errors.length ? usefulInsight : "");
  const verification = clean(experience.verification);
  const structured = {
    problem,
    rootCause,
    failedApproach,
    verifiedFix,
    files,
    verification,
  };

  const labels = [
    ["Problem", problem],
    ["Root cause", rootCause],
    ["Failed approach", failedApproach],
    ["Verified fix", verifiedFix],
    ["Files", files.join(", ")],
    ["Verification", verification],
  ];
  const content = labels
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

  const timestamp = Number(experience.timestamp || Date.now());
  const item = addMemory({
    id: experienceId(task, targetWorkspace, timestamp),
    type: errors.length ? "error" : (verifiedFix || files.length ? "fix" : "execution"),
    content,
    tags: ["agent", experience.intent || "general", errors.length ? "error" : "success"],
    workspace: targetWorkspace,
    meta: {
      important: true,
      taskNormalized: normalizeTaskText(task),
      structured,
      experience: { ...experience, files, errors },
    },
  });

  const saved = item ? [item] : [];
  if (saved.length) {
    linkExperienceToGraph({ task, experience: { ...experience, files, errors }, workspace: targetWorkspace, savedItems: saved });
  }
  return saved;
}
