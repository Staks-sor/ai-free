export function createChatDraftStore() {
  const drafts = new Map();
  const sending = new Set();
  return {
    get: (id) => drafts.get(id) || "",
    set(id, text) { if (id) drafts.set(id, String(text || "")); },
    clear(id) { drafts.delete(id); },
    isSending: (id) => sending.has(id),
    startSend(id) { sending.add(id); },
    finishSend(id) { sending.delete(id); },
  };
}
