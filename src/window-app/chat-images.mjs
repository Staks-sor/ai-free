import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { AUTH_DIR } from "../config.mjs";

const CHAT_IMAGES_DIR = path.join(AUTH_DIR, "chat-images");
const MIME_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/bmp", "bmp"],
]);
const EXTENSION_MIME = new Map(Array.from(MIME_EXTENSIONS, ([mime, extension]) => [extension, mime === "image/jpg" ? "image/jpeg" : mime]));

export function persistChatImages(conversationId, images = []) {
  const safeConversationId = safeSegment(conversationId);
  if (!safeConversationId) return [];
  const saved = [];
  for (const image of Array.isArray(images) ? images : []) {
    const mimeType = String(image?.mimeType || "").toLowerCase();
    const extension = MIME_EXTENSIONS.get(mimeType);
    if (!extension || !image?.dataBase64) continue;
    const buffer = Buffer.from(String(image.dataBase64), "base64");
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) continue;
    const directory = path.join(CHAT_IMAGES_DIR, safeConversationId);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const fileName = `${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(directory, fileName), buffer, { mode: 0o600 });
    saved.push({
      name: String(image.name || fileName),
      mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
      url: `/api/chat-images/${safeConversationId}/${fileName}`,
    });
  }
  return saved;
}

export function resolveChatImage(pathname) {
  const match = String(pathname || "").match(/^\/api\/chat-images\/([a-zA-Z0-9_-]+)\/([a-f0-9-]+\.(?:png|jpg|gif|webp|bmp))$/);
  if (!match) return null;
  const extension = path.extname(match[2]).slice(1).toLowerCase();
  const file = path.join(CHAT_IMAGES_DIR, match[1], match[2]);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return { file, mimeType: EXTENSION_MIME.get(extension) || "application/octet-stream" };
}

export function deleteConversationImages(conversationId) {
  const safeConversationId = safeSegment(conversationId);
  if (!safeConversationId) return;
  fs.rmSync(path.join(CHAT_IMAGES_DIR, safeConversationId), { recursive: true, force: true });
}

function safeSegment(value) {
  const segment = String(value || "");
  return /^[a-zA-Z0-9_-]+$/.test(segment) ? segment : "";
}
