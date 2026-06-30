import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
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

/** Write an executable fake `hermes` (Node script body, no shebang) and return its path. */
function createFakeHermes(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hermes-action-adapter-"));
  const fakeHermes = join(dir, "fake-hermes.js");
  writeFileSync(fakeHermes, `#!/usr/bin/env node\n${body}`);
  chmodSync(fakeHermes, 0o755);
  return fakeHermes;
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

  it("merges extra toolsets after the preset's and de-duplicates", () => {
    const merged = buildHermesCliArgs(run({ preset: { skills: [], toolsets: ["terminal"] } }), "q", ["file"]);
    expect(merged[merged.indexOf("--toolsets") + 1]).toBe("terminal,file");
    const deduped = buildHermesCliArgs(run({ preset: { skills: [], toolsets: ["file", "terminal"] } }), "q", ["file"]);
    expect(deduped[deduped.indexOf("--toolsets") + 1]).toBe("file,terminal");
  });

  it("reports the computed prompt size in a dry run", async () => {
    const config = { ...defaultConfig, runtime: { ...defaultConfig.runtime, command: "hermes" } };
    const result = await runHermesCli(config, run(), true);
    expect(result.dryRun).toBe(true);
    const payload = JSON.parse(result.stdout) as { promptBytes: number; promptChars: number; delivery: string };
    expect(payload.promptBytes).toBeGreaterThan(0);
    expect(payload.promptChars).toBeGreaterThan(0);
    expect(payload.promptBytes).toBe(Buffer.byteLength(result.prompt, "utf8"));
    expect(payload.delivery).toBe("argv");
  });

  it("routes an oversized prompt through the temp-file path and injects the file toolset (dry run)", async () => {
    const big = { path: "big.md", content: "x".repeat(1_000_000) };
    const config = { ...defaultConfig, runtime: { ...defaultConfig.runtime, command: "hermes" } };
    const result = await runHermesCli(config, run({ preset: { skills: [], toolsets: [] }, contextDocuments: [big] }), true);
    const payload = JSON.parse(result.stdout) as { delivery: string; command: string[] };
    expect(payload.delivery).toBe("temp-file");
    const toolsetIndex = payload.command.indexOf("--toolsets");
    expect(toolsetIndex).toBeGreaterThan(-1);
    expect(payload.command[toolsetIndex + 1]).toContain("file");
  });

  it("writes an oversized envelope to a temp file, lets Hermes read it, and cleans up", async () => {
    const fakeHermes = createFakeHermes(
      [
        "const fs = require('node:fs');",
        "const q = process.argv[process.argv.indexOf('-q') + 1] || '';",
        // The pointer lists the temp file on its own line; find the line that is an existing file (handles spaces in TMPDIR).
        "const file = q.split('\\n').map((l) => l.trim()).find((l) => l && fs.existsSync(l)) || '';",
        "const bytes = file ? fs.readFileSync(file, 'utf8').length : 0;",
        "console.log(JSON.stringify({ file, bytes }));",
      ].join("\n"),
    );
    const config = { ...defaultConfig, runtime: { ...defaultConfig.runtime, command: fakeHermes } };
    const big = { path: "big.md", content: "y".repeat(1_000_000) };
    const result = await runHermesCli(config, run({ preset: { skills: [], toolsets: [] }, contextDocuments: [big] }), false);
    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.stdout) as { file: string; bytes: number };
    expect(payload.bytes).toBeGreaterThan(1_000_000);
    expect(existsSync(payload.file)).toBe(false);
  }, 15_000);

  it("terminates Hermes and flags timedOut when the timeout is exceeded", async () => {
    const fakeHermes = createFakeHermes("setTimeout(() => console.log('too late'), 5000);");
    const config = { ...defaultConfig, runtime: { ...defaultConfig.runtime, command: fakeHermes } };
    const result = await runHermesCli(config, run({ timeoutSeconds: 0.3 }), false);
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/timed out/i);
  }, 15_000);

  it("does not fire immediately when the timeout would overflow setTimeout", async () => {
    const fakeHermes = createFakeHermes("setTimeout(() => console.log('done'), 200);");
    const config = { ...defaultConfig, runtime: { ...defaultConfig.runtime, command: fakeHermes } };
    const result = await runHermesCli(config, run({ timeoutSeconds: 3_000_000 }), false);
    expect(result.timedOut).toBeFalsy();
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("done");
  }, 15_000);
});
