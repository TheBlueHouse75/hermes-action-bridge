import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coreChecks, formatDoctor, mcpHandshakeCheck, probeCheck, toReport, type DoctorCheck } from "../src/doctor.js";
import { defaultConfig } from "../src/config.js";
import { installSkills } from "../src/install/install-service.js";
import type { McpCommandRunner } from "../src/install/mcp-service.js";
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

function agentRunner(registered: boolean): McpCommandRunner {
  return (command, args) => {
    if (args[0] === "--version") return { status: 0, stdout: "Agent 1.0", stderr: "" };
    return registered
      ? {
          status: 0,
          stdout: command === "claude"
            ? "Scope: User config\nStatus: ✔ Connected\nType: stdio\nCommand: /opt/bin/hermes-action\nArgs: mcp"
            : "transport: stdio\ncommand: /opt/bin/hermes-action\nargs: mcp",
          stderr: "",
        }
      : { status: 1, stdout: "", stderr: 'No MCP server named "hermes-action".' };
  };
}

describe("doctor", () => {
  it("assembles passing checks when Hermes and config are available", () => {
    const dir = freshDir();
    const ctx: PathContext = { homeDir: dir, cwd: dir };
    installSkills("all", ctx, { scope: "global", force: false, dryRun: false });
    const report = toReport(
      coreChecks(configWith(fakeHermes(dir)), ctx, undefined, {
        launcher: { command: "/opt/bin/hermes-action", args: ["mcp"] },
        commandRunner: agentRunner(true),
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "node",
        "config",
        "hermes",
        "limits",
        "skill:claude-code",
        "skill:codex",
        "mcp:claude-code",
        "mcp:codex",
      ]),
    );
    expect(report.checks.find((check) => check.id === "hermes")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "skill:claude-code")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "mcp:claude-code")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "limits")?.detail).toContain(String(defaultConfig.runtime.maxContextBytes));
  });

  it("fails when an available agent has no MCP registration", () => {
    const dir = freshDir();
    const ctx: PathContext = { homeDir: dir, cwd: dir };
    installSkills("all", ctx, { scope: "global", force: false, dryRun: false });
    const report = toReport(
      coreChecks(configWith(fakeHermes(dir)), ctx, undefined, {
        launcher: { command: "/opt/bin/hermes-action", args: ["mcp"] },
        commandRunner: agentRunner(false),
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === "mcp:codex")).toMatchObject({
      status: "fail",
      detail: expect.stringContaining("not registered"),
    });
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

  it("completes an in-memory MCP handshake without calling Hermes", async () => {
    const check = await mcpHandshakeCheck(configWith("definitely-not-called"));
    expect(check).toMatchObject({ id: "mcp:handshake", status: "pass" });
    expect(check.detail).toMatch(/tools available/);
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
