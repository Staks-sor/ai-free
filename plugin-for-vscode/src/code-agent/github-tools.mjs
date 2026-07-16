// Нативные GitHub-инструменты code agent: сведения о репозитории и GitHub API.
// Авторизация берётся из GITHUB_TOKEN/GH_TOKEN либо из уже настроенного GitHub CLI.

import { spawn } from "node:child_process";

function run(cmd, args, cwd, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, status: null, stdout, stderr, error: error.message });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({ ok: status === 0, status, signal, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function parseGitHubRemote(remote = "") {
  const value = String(remote).trim().replace(/\.git$/i, "");
  const match = value.match(/(?:github\.com[/:])([^/\s]+)\/([^/\s]+)$/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2], slug: `${match[1]}/${match[2]}` };
}

async function git(workspaceRoot, args) {
  return run("git", args, workspaceRoot);
}

async function resolveRepository(workspaceRoot) {
  const root = await git(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  if (!root.ok) throw new Error("Текущая рабочая папка не является Git-репозиторием.");

  const remoteResult = await git(workspaceRoot, ["remote", "get-url", "origin"]);
  const remote = remoteResult.ok ? remoteResult.stdout : "";
  const github = parseGitHubRemote(remote);
  if (!github) throw new Error("Remote origin не указывает на репозиторий GitHub.");

  const branchResult = await git(workspaceRoot, ["branch", "--show-current"]);
  return {
    root: root.stdout,
    remote,
    branch: branchResult.stdout || "HEAD",
    ...github,
  };
}

async function resolveGitHubToken(workspaceRoot) {
  const envToken = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (envToken) return { token: envToken, source: process.env.GITHUB_TOKEN ? "GITHUB_TOKEN" : "GH_TOKEN" };

  const ghToken = await run("gh", ["auth", "token"], workspaceRoot, 8_000);
  if (ghToken.ok && ghToken.stdout) return { token: ghToken.stdout, source: "gh" };
  return { token: "", source: "none" };
}

async function githubApi(workspaceRoot, apiPath, { method = "GET", body } = {}) {
  const auth = await resolveGitHubToken(workspaceRoot);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "ai-free-code-agent",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const suffix = response.status === 401 || response.status === 403
      ? " Настройте GitHub CLI командой gh auth login или переменную GITHUB_TOKEN."
      : "";
    throw new Error(`GitHub API ${response.status}: ${data.message || response.statusText}.${suffix}`);
  }
  return { data, authSource: auth.source };
}

export async function executeGitHubTool(workspaceRoot, call) {
  const tool = String(call.tool || "");
  const repo = await resolveRepository(workspaceRoot);

  if (tool === "github_status") {
    const [status, aheadBehind, auth] = await Promise.all([
      git(workspaceRoot, ["status", "--short", "--branch"]),
      git(workspaceRoot, ["rev-list", "--left-right", "--count", `origin/${repo.branch}...HEAD`]),
      resolveGitHubToken(workspaceRoot),
    ]);
    const counts = aheadBehind.ok ? aheadBehind.stdout.split(/\s+/).map(Number) : [];
    return {
      ok: true,
      repository: repo.slug,
      remote: repo.remote,
      branch: repo.branch,
      authenticated: Boolean(auth.token),
      authSource: auth.source,
      behind: counts[0] || 0,
      ahead: counts[1] || 0,
      workingTree: status.stdout,
      hint: auth.token
        ? "GitHub подключён: доступны чтение и запись через GitHub API."
        : "Git работает. Для приватных репозиториев, issues и pull requests выполните gh auth login или задайте GITHUB_TOKEN.",
    };
  }

  if (tool === "github_repo") {
    const { data, authSource } = await githubApi(workspaceRoot, `/repos/${repo.slug}`);
    return {
      ok: true,
      authSource,
      repository: data.full_name,
      description: data.description || "",
      private: Boolean(data.private),
      defaultBranch: data.default_branch,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      updatedAt: data.updated_at,
    };
  }

  if (tool === "github_issues") {
    const state = call.state === "closed" || call.state === "all" ? call.state : "open";
    const limit = Math.max(1, Math.min(100, Number(call.limit) || 20));
    const { data, authSource } = await githubApi(
      workspaceRoot,
      `/repos/${repo.slug}/issues?state=${state}&per_page=${limit}`,
    );
    return {
      ok: true,
      authSource,
      repository: repo.slug,
      issues: data.filter((item) => !item.pull_request).map((item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        author: item.user?.login || "",
        labels: (item.labels || []).map((label) => label.name),
        updatedAt: item.updated_at,
      })),
    };
  }

  if (tool === "github_create_issue") {
    const title = String(call.title || "").trim();
    if (!title) throw new Error("github_create_issue requires a non-empty title.");
    const labels = Array.isArray(call.labels) ? call.labels.map(String).filter(Boolean).slice(0, 20) : [];
    const { data, authSource } = await githubApi(workspaceRoot, `/repos/${repo.slug}/issues`, {
      method: "POST",
      body: { title, body: String(call.body || ""), ...(labels.length ? { labels } : {}) },
    });
    return {
      ok: true,
      authSource,
      repository: repo.slug,
      number: data.number,
      title: data.title,
      url: data.html_url,
    };
  }

  throw new Error(`Unknown GitHub tool: ${tool}`);
}
