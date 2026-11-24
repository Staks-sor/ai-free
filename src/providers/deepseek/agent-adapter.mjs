// DeepSeek accepts image pixels through uploaded ref_file_ids, rather than an
// inline image field. Keep that transport detail at the adapter boundary so
// the shared agent loop can use the same attachment contract as web providers.

const VISION_TURN_NOTE = "\n\n[SYNVOX: this is a vision image turn. Inspect the attached image before answering; the selected model is restored for later text-only turns.]";

function validImages(images) {
  return Array.isArray(images)
    ? images.filter((image) => image?.dataBase64 && image?.name && image?.mimeType)
    : [];
}

function mergeRefFileIds(...groups) {
  return [...new Set(groups.flat().filter((id) => typeof id === "string" && id))];
}

export function createDeepSeekAgentAdapter(client, options = {}) {
  let pendingRefFileIds = mergeRefFileIds(options.refFileIds);
  const baseModelType = options.modelType ?? null;
  const baseSessionId = options.sessionId ?? null;

  return {
    supportsImageAttachments: true,
    parseToolCall: client.parseToolCall?.bind(client),
    async complete({ prompt, images = [], signal = null, refFileIds = [], ...request } = {}) {
      signal?.throwIfAborted();
      const attachedImages = validImages(images);
      const sessionId = request.sessionId ?? baseSessionId;
      const uploadedRefFileIds = [];

      for (const image of attachedImages) {
        signal?.throwIfAborted();
        const fileId = await client.uploadFile(
          Buffer.from(image.dataBase64, "base64"),
          image.mimeType,
          image.name,
          { chatSessionId: sessionId, signal },
        );
        signal?.throwIfAborted();
        uploadedRefFileIds.push(fileId);
      }

      const turnRefFileIds = mergeRefFileIds(pendingRefFileIds, refFileIds, uploadedRefFileIds);
      const visionTurn = turnRefFileIds.length > 0;
      const effectiveModel = visionTurn ? "vision" : (request.modelType ?? baseModelType);
      const result = await client.complete({
        ...request,
        sessionId,
        prompt: visionTurn ? `${prompt}${VISION_TURN_NOTE}` : prompt,
        modelType: effectiveModel,
        refFileIds: turnRefFileIds,
        signal,
      });
      pendingRefFileIds = [];
      return { ...result, modelType: effectiveModel, effectiveModel, visionTurn };
    },
  };
}
