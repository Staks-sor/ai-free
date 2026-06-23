// Форматирование tool logs для memory extractor и UI progress.

import { formatSnapshotForToolLog } from "../browser/snapshot-build.mjs";

export function formatToolLog(call, result) {
  const target = call.path || call.cmd || "";
  const header = `[tool] ${call.tool} ${target}`.trim();

  if (call.tool === "list_files") {
    const lines = [header];
    if (result.error) {
      lines.push(`error: ${result.error}`);
      return lines.join("\n");
    }
    const entries = Array.isArray(result.entries) ? result.entries : [];
    lines.push(`entries: ${entries.length}${result.truncated ? " (truncated)" : ""}`);
    if (entries.length) {
      lines.push(entries.slice(0, 80).join("\n"));
      if (entries.length > 80) lines.push(`[${entries.length - 80} more omitted from log]`);
    } else {
      lines.push("[empty]");
    }
    return lines.join("\n");
  }

  if (call.tool === "list_serial_ports") {
    const lines = [header];
    if (result.error) {
      lines.push(`error: ${result.error}`);
      return lines.join("\n");
    }
    const ports = Array.isArray(result.ports) ? result.ports : [];
    lines.push(`ports: ${ports.length}`);
    lines.push(ports.length ? ports.join("\n") : "[none]");
    return lines.join("\n");
  }

  if (call.tool === "ask_user") {
    const lines = [header];
    if (result.error) lines.push(`error: ${result.error}`);
    if (result.userQuestion?.question) lines.push(result.userQuestion.question);
    return lines.join("\n");
  }

  if (call.tool === "browser_snapshot") {
    const lines = [header];
    if (result.error) lines.push(`error: ${result.error}`);
    else lines.push(formatSnapshotForToolLog(result));
    return lines.join("\n");
  }

  if (call.tool === "browser_navigate") {
    const lines = [header];
    if (result.error) lines.push(`error: ${result.error}`);
    else {
      lines.push(`url: ${result.url || call.url || ""}`);
      if (result.title) lines.push(`title: ${result.title}`);
      if (result.rewritten) lines.push(`rewritten: ${result.originalUrl || call.url} → ${result.url}`);
      if (result.hint) lines.push(`hint: ${result.hint}`);
      if (result.captchaHint) lines.push(`captcha: ${result.captchaHint}`);
    }
    return lines.join("\n");
  }

  if (call.tool === "browser_click") {
    const lines = [header];
    if (call.ref) lines.push(`ref: ${call.ref}`);
    if (call.text) lines.push(`text: ${call.text}`);
    if (call.selector) lines.push(`selector: ${call.selector}`);
    if (call.x != null && call.y != null) lines.push(`coords: ${call.x},${call.y}`);
    if (result.error) lines.push(`error: ${result.error}`);
    else {
      lines.push(`url: ${result.url || ""}`);
      if (result.title) lines.push(`title: ${result.title}`);
    }
    return lines.join("\n");
  }

  if (call.tool === "browser_type") {
    const lines = [header];
    if (call.ref) lines.push(`ref: ${call.ref}`);
    if (call.text) lines.push(`text: ${String(call.text).slice(0, 120)}`);
    if (result.error) lines.push(`error: ${result.error}`);
    else lines.push(`url: ${result.url || ""}`);
    return lines.join("\n");
  }

  if (call.tool === "browser_key") {
    const lines = [header];
    lines.push(`key: ${call.key || result.key || "Enter"}`);
    if (result.error) lines.push(`error: ${result.error}`);
    else lines.push(`url: ${result.url || ""}`);
    return lines.join("\n");
  }

  if (call.tool === "browser_scroll") {
    const lines = [header];
    if (call.ref) lines.push(`ref: ${call.ref}`);
    lines.push(`deltaY: ${call.deltaY ?? result.deltaY ?? 0}`);
    if (result.error) lines.push(`error: ${result.error}`);
    else lines.push(`url: ${result.url || ""}`);
    return lines.join("\n");
  }

  if (call.tool === "browser_wait") {
    const lines = [header];
    if (call.ms != null) lines.push(`ms: ${call.ms}`);
    if (call.until) lines.push(`until: ${call.until}`);
    if (result.error) lines.push(`error: ${result.error}`);
    else lines.push(`url: ${result.url || ""}`);
    return lines.join("\n");
  }

  if (call.tool === "browser_go_back" || call.tool === "browser_list_tabs" || call.tool === "browser_switch_tab" || call.tool === "browser_reset") {
    const lines = [header];
    if (result.error) lines.push(`error: ${result.error}`);
    else if (call.tool === "browser_list_tabs") {
      const tabs = Array.isArray(result.tabs) ? result.tabs : [];
      lines.push(`tabs: ${tabs.length}`);
      for (const tab of tabs.slice(0, 8)) {
        lines.push(`  [${tab.index}] ${tab.url}${tab.active ? " (active)" : ""}`);
      }
    } else {
      lines.push(`url: ${result.url || ""}`);
      if (result.index != null) lines.push(`index: ${result.index}`);
    }
    return lines.join("\n");
  }

  if (call.tool !== "run_command" && call.tool !== "run_shell") {
    if (result.error) return `${header}\nerror: ${result.error}`;
    return header;
  }

  const lines = [header];
  if (call.tool === "run_shell" && call.command) {
    lines.push(`command: ${call.command}`);
  }
  if (result.status !== undefined) {
    lines.push(`status: ${result.status}${result.timedOut ? " (timed out)" : ""}`);
  } else if (result.error) {
    lines.push(`error: ${result.error}`);
  }
  if (result.installRequest) {
    lines.push(`install request: ${result.installRequest.title}`);
  }
  if (result.permissionRequest) {
    lines.push(`permission request: ${result.permissionRequest.title}`);
  }
  if (result.stdout) lines.push(`stdout:\n${result.stdout.trimEnd()}`);
  if (result.stderr) lines.push(`stderr:\n${result.stderr.trimEnd()}`);
  if (!result.stdout && !result.stderr && !result.error) lines.push("[no output]");
  return lines.join("\n");
}
