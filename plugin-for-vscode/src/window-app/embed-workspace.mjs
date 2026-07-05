// Встроенный file-browser для drawer (iframe /embed/workspace).

export function renderEmbedWorkspaceHtml({ root = "", title = "Workspace" } = {}) {
  const safeRoot = String(root || "").replace(/"/g, "&quot;");
  const safeTitle = String(title || "Workspace").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; --bg:#0e1116; --panel:#161a23; --line:rgba(255,255,255,.08); --text:#edf1f7; --muted:#8b96a7; --accent:#4d7cff; }
    * { box-sizing: border-box; }
    body { margin:0; font:14px/1.4 Inter, system-ui, sans-serif; background:var(--bg); color:var(--text); }
    header { display:flex; gap:8px; align-items:center; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel); }
    header button { border:1px solid var(--line); background:#1a1f27; color:var(--text); border-radius:6px; padding:6px 10px; cursor:pointer; }
    header button:hover { border-color:var(--accent); }
    #path { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--muted); font-size:12px; }
    main { padding:8px; display:grid; gap:4px; max-height:calc(100vh - 52px); overflow:auto; }
    .row { display:flex; gap:8px; align-items:center; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:#12161d; cursor:pointer; }
    .row:hover { border-color:var(--accent); }
    .row.dir::before { content:"📁"; }
    .row.file::before { content:"📄"; }
    .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .empty { padding:16px; color:var(--muted); text-align:center; }
    .err { padding:16px; color:#ff776d; }
  </style>
</head>
<body>
  <header>
    <button type="button" id="upBtn" title="Up">↑</button>
    <button type="button" id="refreshBtn" title="Refresh">↻</button>
    <div id="path"></div>
  </header>
  <main id="list"><div class="empty">Loading…</div></main>
  <script>
    let current = ${JSON.stringify(String(root || ""))};
    const pathEl = document.getElementById("path");
    const listEl = document.getElementById("list");
    document.getElementById("refreshBtn").addEventListener("click", () => load(current));
    document.getElementById("upBtn").addEventListener("click", () => {
      if (!current) return;
      const parts = current.split("/").filter(Boolean);
      parts.pop();
      load(parts.length ? "/" + parts.join("/") : "/");
    });
    async function load(path) {
      listEl.innerHTML = '<div class="empty">Loading…</div>';
      pathEl.textContent = path || "/";
      try {
        const res = await fetch("/api/browse?path=" + encodeURIComponent(path || ""));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        current = data.path || path;
        pathEl.textContent = current;
        const dirs = Array.isArray(data.directories) ? data.directories : [];
        if (!dirs.length) {
          listEl.innerHTML = '<div class="empty">No folders here</div>';
          return;
        }
        listEl.innerHTML = "";
        for (const dir of dirs) {
          const row = document.createElement("div");
          row.className = "row dir";
          row.innerHTML = '<div class="name"></div>';
          row.querySelector(".name").textContent = dir.name;
          row.addEventListener("click", () => load(dir.path));
          listEl.appendChild(row);
        }
      } catch (err) {
        listEl.innerHTML = '<div class="err">' + err.message + '</div>';
      }
    }
    load(current);
  </script>
</body>
</html>`;
}
