import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("loads project config and normalizes snake_case fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-config-"));
    const configPath = join(dir, ".hermes-action.yaml");
    writeFileSync(
      configPath,
      [
        "runtime:",
        "  adapter: hermes-cli",
        "  command: fake-hermes",
        "defaults:",
        "  mode: execute",
        "  source: test-agent",
        "  max_turns: 7",
        "  preset: research",
        "presets:",
        "  research:",
        "    skills: [research-growth-operations]",
        "    toolsets: [web]",
        "policy:",
        "  yolo: false",
      ].join("\n"),
    );

    const config = loadConfig(dir);
    expect(config.runtime.command).toBe("fake-hermes");
    expect(config.defaults.mode).toBe("execute");
    expect(config.defaults.maxTurns).toBe(7);
    expect(config.presets.research?.skills).toEqual(["research-growth-operations"]);
  });

  it("loads global config before project config", () => {
    const xdg = mkdtempSync(join(tmpdir(), "hermes-action-xdg-"));
    mkdirSync(join(xdg, "hermes-action"), { recursive: true });
    writeFileSync(join(xdg, "hermes-action", "config.yaml"), "runtime:\n  command: global-hermes\n");
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-project-"));
    writeFileSync(join(dir, ".hermes-action.yaml"), "runtime:\n  command: project-hermes\n");
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    try {
      expect(loadConfig(dir).runtime.command).toBe("project-hermes");
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });
});
