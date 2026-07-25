import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson } from "./helpers/json.js";

type JsonObject = Record<string, unknown>;

function requireObject(value: unknown, label: string): JsonObject {
  expect(value, `${label} must be a JSON object`).toSatisfy(
    (candidate: unknown) => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate),
  );
  return value as JsonObject;
}

function requireString(value: unknown, label: string): string {
  expect(value, `${label} must be a non-empty string`).toSatisfy(
    (candidate: unknown) => typeof candidate === "string" && candidate.length > 0,
  );
  return value as string;
}

function loadPluginFixture(marketplace: JsonObject): {
  plugin: JsonObject;
  directory: string;
  manifest: JsonObject;
} {
  const plugins = marketplace.plugins;
  expect(Array.isArray(plugins)).toBe(true);
  expect(plugins).toHaveLength(1);

  const plugin = requireObject((plugins as unknown[])[0], "marketplace plugin");
  const source = requireString(plugin.source, "marketplace plugin source");
  const directory = resolve(process.cwd(), source);
  return {
    plugin,
    directory,
    manifest: readJson(join(source, ".claude-plugin", "plugin.json")),
  };
}

describe("Claude Code plugin distribution", () => {
  const marketplacePath = ".claude-plugin/marketplace.json";
  const marketplace = readJson(marketplacePath);
  const packageJson = readJson("package.json");
  const packageVersion = requireString(packageJson.version, "package.json version");
  const pluginFixture = loadPluginFixture(marketplace);

  it("keeps marketplace and plugin versions synchronized with the npm package", () => {
    expect(pluginFixture.plugin.version).toBe(packageVersion);
    expect(pluginFixture.manifest.version).toBe(packageVersion);
  });

  it("references the in-repository Claude plugin, skill, and MCP configuration", () => {
    const pluginDirectory = pluginFixture.directory;

    expect(pluginDirectory).toBe(resolve(process.cwd(), "plugins/hermes-action"));
    expect(statSync(pluginDirectory).isDirectory()).toBe(true);

    const skillPath = join(pluginDirectory, "skills", "hermes-action-bridge", "SKILL.md");
    const mcpPath = join(pluginDirectory, ".mcp.json");
    const pluginManifestPath = join(pluginDirectory, ".claude-plugin", "plugin.json");
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(mcpPath)).toBe(true);
    expect(existsSync(pluginManifestPath)).toBe(true);
  });

  it("publishes required marketplace and plugin metadata", () => {
    const owner = requireObject(marketplace.owner, "marketplace owner");
    const { plugin, manifest: pluginManifest } = pluginFixture;

    expect(owner.name).toBe("Cyril Guilleminot");
    expect(owner.url).toBe("https://github.com/TheBlueHouse75");
    expect(plugin.repository).toBe("https://github.com/TheBlueHouse75/hermes-action-bridge");
    expect(plugin.license).toBe("MIT");
    expect(pluginManifest.repository).toBe(plugin.repository);
    expect(pluginManifest.license).toBe(plugin.license);
    expect(pluginManifest.author).toEqual(plugin.author);
  });
});
