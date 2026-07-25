import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as Record<string, unknown>;
}

describe("published metadata", () => {
  it("keeps package, MCP registry, and Codex plugin versions synchronized", () => {
    const packageJson = readJson("package.json");
    const serverJson = readJson("server.json");
    const pluginJson = readJson("plugins/hermes-action/.codex-plugin/plugin.json");

    expect(serverJson.version).toBe(packageJson.version);
    expect(pluginJson.version).toBe(packageJson.version);
  });

  it("uses the supported Codex plugin MCP manifest shape", () => {
    const manifest = readJson("plugins/hermes-action/.mcp.json");

    expect(manifest).toHaveProperty("mcpServers.hermes-action");
    expect(manifest).not.toHaveProperty("mcp_servers");
  });

  it("includes the Codex plugin in the npm package", () => {
    const packageJson = readJson("package.json");
    const files = packageJson.files;

    expect(Array.isArray(files)).toBe(true);
    expect(files).toContain("plugins");
  });
});
