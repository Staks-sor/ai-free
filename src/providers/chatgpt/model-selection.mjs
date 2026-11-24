import { findProviderModel, getProviderDefaultModel } from '../model-catalog.mjs';

export function resolveChatGPTRequestedModel(modelId) {
  const model = findProviderModel('chatgpt', modelId || getProviderDefaultModel('chatgpt'));
  if (!model) throw createChatGPTModelUnavailableError(modelId);
  return model;
}

export function normalizeChatGPTModelLabel(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase()
    .replace(/\s+/gu, ' ');
}

export function createChatGPTModelUnavailableError(modelId) {
  const error = new Error(`ChatGPT Web model "${String(modelId || 'unknown')}" is not available in the current model picker; no message was sent.`);
  error.code = 'CHATGPT_MODEL_UNAVAILABLE';
  error.delivery = 'not_sent';
  return error;
}

export function resolveChatGPTModelSelection(model, currentLabel = '') {
  if (model?.useSessionModel === true) return { labels: [], alreadySelected: true };
  const labels = Array.isArray(model?.webLabels)
    ? model.webLabels.filter(label => typeof label === 'string' && label.trim()) : [];
  if (!labels.length) throw createChatGPTModelUnavailableError(model?.id);
  const current = normalizeChatGPTModelLabel(currentLabel);
  return { labels, alreadySelected: Boolean(current) && labels.some(label =>
    normalizeChatGPTModelLabel(label) === current) };
}
