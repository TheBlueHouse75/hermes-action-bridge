import { mcpServerEntry, mcpServerName, mcpSnippetCodexToml, mcpSnippetJson } from "./templates.js";
import { applyFileEdit, type EditResult } from "./file-edit.js";
import type { FileChange } from "./types.js";

export interface McpClientSnippet {
  client: string;
  location: string;
  content: string;
}

/** Copy-paste MCP config per client. Printing is the default; only the Claude Code writer mutates a file. */
export function mcpSnippets(): McpClientSnippet[] {
  return [
    { client: "Claude Code / Cursor / VS Code", location: "project .mcp.json (or ~/.cursor/mcp.json)", content: mcpSnippetJson() },
    { client: "Codex", location: "~/.codex/config.toml", content: mcpSnippetCodexToml() },
  ];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function render(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Stable serialization (object keys sorted) so the idempotency check ignores key order. */
function canonical(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, val) =>
    isObject(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val,
  );
}

/** Add the hermes-action server to a Claude Code `.mcp.json`, preserving every other key. */
export function mergeMcpJson(existing: string | null): EditResult {
  if (existing === null) return { content: render({ mcpServers: { [mcpServerName]: mcpServerEntry } }), action: "created" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return { content: existing, action: "refused", reason: "existing .mcp.json is not valid JSON" };
  }
  if (!isObject(parsed)) return { content: existing, action: "refused", reason: "existing .mcp.json is not a JSON object" };
  if ("mcpServers" in parsed && !isObject(parsed.mcpServers)) {
    return { content: existing, action: "refused", reason: "existing .mcp.json has a non-object mcpServers; refusing to overwrite" };
  }
  const servers = isObject(parsed.mcpServers) ? parsed.mcpServers : {};
  if (canonical(servers[mcpServerName]) === canonical(mcpServerEntry)) return { content: existing, action: "unchanged" };
  return { content: render({ ...parsed, mcpServers: { ...servers, [mcpServerName]: mcpServerEntry } }), action: "updated" };
}

/** Remove the hermes-action server from a Claude Code `.mcp.json`, leaving other servers in place. */
export function unmergeMcpJson(existing: string | null): EditResult {
  if (existing === null) return { content: "", action: "unchanged" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return { content: existing, action: "refused", reason: "existing .mcp.json is not valid JSON" };
  }
  if (!isObject(parsed) || !isObject(parsed.mcpServers) || !(mcpServerName in parsed.mcpServers)) {
    return { content: existing, action: "unchanged" };
  }
  const servers = { ...parsed.mcpServers };
  delete servers[mcpServerName];
  return { content: render({ ...parsed, mcpServers: servers }), action: "removed" };
}

export function writeMcpJson(file: string, dryRun: boolean): FileChange {
  return applyFileEdit(file, mergeMcpJson, dryRun);
}

export function removeMcpJson(file: string, dryRun: boolean): FileChange {
  return applyFileEdit(file, unmergeMcpJson, dryRun);
}
