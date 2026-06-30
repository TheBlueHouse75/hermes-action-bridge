import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coreChecks, formatDoctor, probeCheck, toReport, type DoctorCheck } from "../src/doctor.js";
import { defaultConfig } from "../src/config.js";
import type { BridgeConfig } from "../src/types.js";
import type { PathContext } from "../src/install/types.js";

function fakeHermes(dir: string): string {
  const path = join(dir, "fake-hermes.js");
  writeFileSync(
    path,
    ["#!/usr/bin/env node", "if (process.argv.includes('--version')) { console.log('Fake Hermes 1.0'); process.exit(0); }", "console.log('BRIDGE_OK');"].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}

function configWith(command: string): BridgeConfig {
  return { ...defaultConfig, runtime: { ...defaultConfig.runtime, command } };
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "hab-doctor-"));
}

describe("doctor", () => {
  it("assembles passing checks when Hermes and config are available", () => {
    const dir = freshDir();
    const ctx: PathContext = { homeDir: dir, cwd: dir };
    const report = toReport(coreChecks(configWith(fakeHermes(dir)), ctx));
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["node", "config", "hermes", "skill:claude-code", "skill:codex"]),
    );
    expect(report.checks.find((check) => check.id === "hermes")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "skill:claude-code")?.status).toBe("warn");
  });

  it("fails when configuration cannot be loaded", () => {
    const dir = freshDir();
    const report = toReport(coreChecks(null, { homeDir: dir, cwd: dir }, "bad yaml"));
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "config")).toMatchObject({ status: "fail", detail: "bad yaml" });
  });

  it("probe passes when Hermes echoes the sentinel", async () => {
    const dir = freshDir();
    const check = await probeCheck(configWith(fakeHermes(dir)));
    expect(check.status).toBe("pass");
  });

  it("probe accepts the sentinel on stderr", async () => {
    const dir = freshDir();
    const path = join(dir, "stderr-hermes.js");
    writeFileSync(path, ["#!/usr/bin/env node", "console.error('BRIDGE_OK');"].join("\n"));
    chmodSync(path, 0o755);
    const check = await probeCheck(configWith(path));
    expect(check.status).toBe("pass");
  });

  it("formats a human-readable report", () => {
    const checks: DoctorCheck[] = [
      { id: "node", status: "pass", detail: "v22" },
      { id: "hermes", status: "fail", detail: "missing" },
    ];
    const text = formatDoctor(toReport(checks));
    expect(text).toContain("[ok] node: v22");
    expect(text).toContain("[FAIL] hermes: missing");
    expect(text).toContain("Some required checks failed.");
  });
});
