// Сбор accessibility-подобного снимка страницы + ref-id на интерактивные элементы.

export const SNAPSHOT_FORMAT = "accessibility-v2";

/**
 * Выполняется внутри page.evaluate — возвращает сериализуемый объект.
 * @param {number} maxTextChars
 * @param {number} maxRefs
 */
export function buildPageSnapshotScript(maxTextChars = 8000, maxRefs = 80) {
  return ({ maxTextChars: maxText, maxRefs: maxR }) => {
    const capText = Math.max(500, Math.min(20000, Number(maxText) || 8000));
    const capRefs = Math.max(10, Math.min(120, Number(maxR) || 80));

    document.querySelectorAll("[data-ai-free-ref]").forEach((el) => {
      el.removeAttribute("data-ai-free-ref");
    });

    function visible(el) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      if (rect.bottom < 0 || rect.top > innerHeight) return false;
      if (rect.right < 0 || rect.left > innerWidth) return false;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      return true;
    }

    function accName(el) {
      return String(
        el.getAttribute("aria-label")
        || el.getAttribute("alt")
        || el.getAttribute("title")
        || el.getAttribute("placeholder")
        || el.getAttribute("value")
        || el.innerText
        || "",
      ).replace(/\s+/g, " ").trim().slice(0, 120);
    }

    function roleOf(el) {
      const explicit = el.getAttribute("role");
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const t = (el.getAttribute("type") || "text").toLowerCase();
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "submit" || t === "button") return "button";
        return "textbox";
      }
      return tag;
    }

    const refs = [];
    let refCounter = 0;

    function assignRef(el, extra = {}) {
      if (refs.length >= capRefs) return null;
      if (!visible(el)) return null;
      refCounter += 1;
      const ref = `e${refCounter}`;
      el.setAttribute("data-ai-free-ref", ref);
      const name = accName(el);
      const entry = {
        ref,
        role: roleOf(el),
        name: name || "(unnamed)",
        tag: el.tagName.toLowerCase(),
        ...extra,
      };
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        entry.value = String(el.value || "").slice(0, 200);
      }
      if (el.tagName === "A") {
        entry.href = String(el.getAttribute("href") || "").slice(0, 200);
      }
      refs.push(entry);
      return ref;
    }

    const selectors = [
      "a[href]",
      "button",
      "input:not([type=hidden])",
      "select",
      "textarea",
      "[role=button]",
      "[role=link]",
      "[role=textbox]",
      "[role=checkbox]",
      "[role=radio]",
      "[role=combobox]",
      "[role=menuitem]",
      "[role=tab]",
    ].join(",");

    for (const el of document.querySelectorAll(selectors)) {
      assignRef(el);
      if (refs.length >= capRefs) break;
    }

    const treeLines = [];
    function walk(el, depth) {
      if (!el || depth > 10 || treeLines.length > 120) return;
      if (el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript") return;

      const ref = el.getAttribute("data-ai-free-ref");
      const role = roleOf(el);
      const name = accName(el);
      const interesting = ref
        || ["h1", "h2", "h3", "h4", "main", "nav", "form", "header", "footer"].includes(tag)
        || (name && ["button", "a", "input", "select", "textarea"].includes(tag));

      if (interesting && (ref || name || ["main", "nav", "form", "h1", "h2", "h3"].includes(tag))) {
        const indent = "  ".repeat(Math.min(depth, 8));
        const label = name ? ` "${name.replace(/"/g, "'")}"` : "";
        const refTag = ref ? ` [${ref}]` : "";
        treeLines.push(`${indent}- ${role}${label}${refTag}`);
      }

      for (const child of el.children) {
        walk(child, depth + 1);
      }
    }

    walk(document.body, 0);

    const rawText = String(document.body?.innerText || "")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      format: "accessibility-v2",
      url: location.href,
      title: String(document.title || ""),
      text: rawText.slice(0, capText),
      truncated: rawText.length > capText,
      tree: treeLines.join("\n"),
      refs,
    };
  };
}

export function formatSnapshotForPrompt(snapshot) {
  if (!snapshot?.ok || snapshot.empty) return "";
  const lines = [
    `[BROWSER snapshot ${snapshot.format || SNAPSHOT_FORMAT}]`,
    `URL: ${snapshot.url || "(unknown)"}`,
  ];
  if (snapshot.title) lines.push(`Title: ${snapshot.title}`);
  if (snapshot.tree) {
    lines.push("Accessibility tree (use ref in browser_click/browser_type):");
    lines.push(snapshot.tree);
  }
  if (Array.isArray(snapshot.refs) && snapshot.refs.length) {
    lines.push("Interactive refs:");
    for (const item of snapshot.refs.slice(0, 40)) {
      const extra = item.value != null ? ` value="${String(item.value).slice(0, 60)}"` : "";
      lines.push(`  [${item.ref}] ${item.role} "${item.name}"${extra}`);
    }
    if (snapshot.refs.length > 40) {
      lines.push(`  … +${snapshot.refs.length - 40} more`);
    }
  }
  if (snapshot.text) {
    lines.push("Visible text:");
    lines.push(String(snapshot.text).slice(0, 4000));
    if (snapshot.truncated) lines.push("[… text truncated …]");
  }
  if (snapshot.screenshot?.path) {
    lines.push(`Screenshot: ${snapshot.screenshot.path} (${snapshot.screenshot.bytes || 0} bytes)`);
  }
  return lines.join("\n");
}

export function formatSnapshotForToolLog(snapshot) {
  const lines = [];
  lines.push(`url: ${snapshot.url || ""}`);
  if (snapshot.title) lines.push(`title: ${snapshot.title}`);
  lines.push(`refs: ${Array.isArray(snapshot.refs) ? snapshot.refs.length : 0}`);
  if (snapshot.tree) lines.push(String(snapshot.tree).slice(0, 800));
  if (snapshot.screenshot?.path) lines.push(`screenshot: ${snapshot.screenshot.path}`);
  return lines.join("\n");
}
