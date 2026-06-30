import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHermesCliArgs, runHermesCli } from "../src/adapters/hermes-cli.js";
import { defaultConfig } from "../src/config.js";
import type { EffectiveRun } from "../src/types.js";

function run(overrides: Partial<EffectiveRun> = {}): EffectiveRun {
  return {
    mode: "plan",
    requestedMode: "plan",
    presetName: "default",
    preset: { skills: ["hermes-agent"], toolsets: ["terminal", "file"] },
    prompt: "Summarize this",
    source: "external-agent",
    maxTurns: 30,
    yolo: false,
    detectedRisks: [],
    contextDocuments: [],
    timeoutSeconds: 30,
    ...overrides,
  };
}

describe("Hermes CLI adapter", () => {
  it("builds a hermes chat command with skills and toolsets", () => {
    const args = buildHermesCliArgs(run());
    expect(args.slice(0, 2)).toEqual(["chat", "-Q"]);
    expect(args).toContain("--skills");
    expect(args).toContain("hermes-agent");
    expect(args).toContain("--toolsets");
    expect(args).toContain("terminal,file");
    expect(args).toContain("-q");
  });

  it("passes --yolo only when explicitly enabled", () => {
    expect(buildHermesCliArgs(run())).not.toContain("--yolo");
    expect(buildHermesCliArgs(run({ yolo: true }))).toContain("--yolo");
  });

  it("terminates Hermes and flags timedOut when the timeout is exceeded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-timeout-"));
    const fakeHermes = join(dir, "fake-hermes.js");
    writeFileSync(fakeHermes, "#!/usr/bin/env node\nsetTimeout(() => console.log('too late'), 5000);\n");
    chmodSync(fakeHermes, 0o755);
    const config = { ...defaultConfig, runtime: { ...defaultConfig.runtime, command: fakeHermes } };
    const result = await runHermesCli(config, run({ timeoutSeconds: 0.3 }), false);
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/timed out/i);
  }, 15_000);

  it("does not fire immediately when the timeout would overflow setTimeout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-bigtimeout-"));
    const fakeHermes = join(dir, "fake-hermes.js");
    writeFileSync(fakeHermes, "#!/usr/bin/env node\nsetTimeout(() => console.log('done'), 200);\n");
    chmodSync(fakeHermes, 0o755);
    const config = { ...defaultConfig, runtime: { ...defaultConfig.runtime, command: fakeHermes } };
    const result = await runHermesCli(config, run({ timeoutSeconds: 3_000_000 }), false);
    expect(result.timedOut).toBeFalsy();
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("done");
  }, 15_000);
});
