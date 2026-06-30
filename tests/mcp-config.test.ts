import { describe, expect, it } from "vitest";
import { mcpSnippets, mergeMcpJson, unmergeMcpJson } from "../src/install/mcp-config.js";

describe("mcp config", () => {
  it("prints a JSON snippet and a Codex TOML snippet", () => {
    const snippets = mcpSnippets();
    expect(snippets).toHaveLength(2);
    expect(snippets[0]?.content).toContain('"hermes-action"');
    expect(snippets[1]?.content).toContain("[mcp_servers.hermes-action]");
  });

  it("creates a fresh .mcp.json", () => {
    const result = mergeMcpJson(null);
    expect(result.action).toBe("created");
    expect(JSON.parse(result.content).mcpServers["hermes-action"]).toEqual({ command: "hermes-action", args: ["mcp"] });
  });

  it("merges into an existing file, preserving other servers, and is idempotent", () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2);
    const merged = mergeMcpJson(existing);
    expect(merged.action).toBe("updated");
    const parsed = JSON.parse(merged.content);
    expect(parsed.mcpServers.other).toEqual({ command: "x" });
    expect(parsed.mcpServers["hermes-action"]).toBeDefined();
    expect(mergeMcpJson(merged.content).action).toBe("unchanged");
  });

  it("refuses to touch invalid or non-object JSON", () => {
    expect(mergeMcpJson("{ not json").action).toBe("refused");
    expect(mergeMcpJson("[]").action).toBe("refused");
  });

  it("refuses to overwrite a non-object mcpServers (no data loss)", () => {
    const result = mergeMcpJson(JSON.stringify({ mcpServers: "TODO", keep: 1 }));
    expect(result.action).toBe("refused");
    expect(JSON.parse(result.content).keep).toBe(1);
  });

  it("is idempotent regardless of key order in the existing entry", () => {
    const existing = JSON.stringify({ mcpServers: { "hermes-action": { args: ["mcp"], command: "hermes-action" } } });
    expect(mergeMcpJson(existing).action).toBe("unchanged");
  });

  it("removes only the hermes-action server", () => {
    const existing = mergeMcpJson(JSON.stringify({ mcpServers: { other: { command: "x" } } })).content;
    const removed = unmergeMcpJson(existing);
    expect(removed.action).toBe("removed");
    const parsed = JSON.parse(removed.content);
    expect(parsed.mcpServers.other).toBeDefined();
    expect(parsed.mcpServers["hermes-action"]).toBeUndefined();
    expect(unmergeMcpJson(removed.content).action).toBe("unchanged");
  });
});
