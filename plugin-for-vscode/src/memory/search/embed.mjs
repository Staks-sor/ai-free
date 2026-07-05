// Локальные эмбеддинги без внешних моделей — feature hashing (offline).

const DIM = 256;

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._/-]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function embedText(text) {
  const vec = new Float32Array(DIM);
  for (const token of tokenize(text)) {
    const bucket = hashToken(token) % DIM;
    vec[bucket] += 1;
  }
  return normalize(vec);
}

function normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  return vec;
}

export function serializeVector(vec) {
  return JSON.stringify(Array.from(vec));
}

export function deserializeVector(raw) {
  if (!raw) return null;
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr) || !arr.length) return null;
    return Float32Array.from(arr.map(Number));
  } catch {
    return null;
  }
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export function buildEmbedDocument(item = {}) {
  const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
  return [item.type, item.workspace, tags, item.content].filter(Boolean).join("\n");
}

export const EMBED_DIM = DIM;
