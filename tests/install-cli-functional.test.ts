import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";

const cli = join(process.cwd(), "dist", "cli.js");

function run(home: string, args: string[], cwd: string = process.cwd()): { stdout: string; stderr: string; status: number } {
  const fakeBin = installFakeAgents(home);
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      env: { ...process.env, HOME: home, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` },
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { stdout, stderr: "", status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: typeof e.status === "number" ? e.status : 1 };
  }
}

function home(): string {
  return mkdtempSync(join(tmpdir(), "hab-cli-"));
}

const claudeSkill = (h: string) => join(h, ".claude", "skills", "hermes-action-bridge", "SKILL.md");
const codexSkill = (h: string) => join(h, ".codex", "skills", "hermes-action-bridge", "SKILL.md");
const claudeLock = (h: string) => join(h, ".claude", "skills", "hermes-action-bridge", ".hermes-action-managed.json");
const mcpState = (h: string, command: string) => join(h, `.fake-${command}-mcp`);

function installFakeAgents(homeDir: string): string {
  const bin = join(homeDir, "bin");
  mkdirSync(bin, { recursive: true });
  for (const command of ["codex", "claude"]) {
    const path = join(bin, command);
    if (existsSync(path)) continue;
    const state = mcpState(homeDir, command);
    const body = [
      "#!/usr/bin/env node",
      "import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';",
      `const state = ${JSON.stringify(state)};`,
      `const command = ${JSON.stringify(command)};`,
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') { console.log(`${command} 1.0.0`); process.exit(0); }",
      "if (args[0] !== 'mcp') process.exit(2);",
      "if (args[1] === 'get') {",
      "  if (!existsSync(state)) { console.error('No MCP server named \"hermes-action\".'); process.exit(1); }",
      "  const launcher = readFileSync(state, 'utf8');",
      "  console.log(command === 'claude'",
      "    ? `Scope: User config\\nStatus: ✔ Connected\\nType: stdio\\nCommand: ${launcher}\\nArgs: mcp`",
      "    : `transport: stdio\\ncommand: ${launcher}\\nargs: mcp`);",
      "  process.exit(0);",
      "}",
      "if (args.includes('add')) {",
      "  const separator = args.indexOf('--');",
      "  writeFileSync(state, args[separator + 1] ?? '', 'utf8');",
      "  process.exit(0);",
      "}",
      "if (args.includes('remove')) { rmSync(state, { force: true }); process.exit(0); }",
      "process.exit(2);",
    ].join("\n");
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  }
  return bin;
}

describe("install CLI", () => {
  it("installs both agents, is idempotent, and never touches instruction files", () => {
    const h = home();
    expect(run(h, ["install", "all"]).status).toBe(0);
    expect(existsSync(claudeSkill(h))).toBe(true);
    expect(existsSync(codexSkill(h))).toBe(true);
    expect(existsSync(join(h, ".claude", "skills", "hermes-action-bridge", ".hermes-action-managed.json"))).toBe(true);
    expect(existsSync(mcpState(h, "claude"))).toBe(true);
    expect(existsSync(mcpState(h, "codex"))).toBe(true);
    expect(existsSync(join(h, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(h, "AGENTS.md"))).toBe(false);
    expect(run(h, ["install", "claude-code"]).stdout).toContain("unchanged");
  }, 30_000);

  it("dry-run and print write nothing", () => {
    const h = home();
    expect(run(h, ["install", "codex", "--dry-run"]).stdout).toContain("(dry-run)");
    expect(existsSync(codexSkill(h))).toBe(false);
    const printed = run(h, ["install", "codex", "--print"]);
    expect(printed.stdout).toContain("# Hermes Action Bridge");
    expect(existsSync(codexSkill(h))).toBe(false);
  }, 30_000);

  it("refuses a foreign skill directory with a non-zero exit", () => {
    const h = home();
    mkdirSync(join(h, ".claude", "skills", "hermes-action-bridge"), { recursive: true });
    writeFileSync(claudeSkill(h), "my own skill\n");
    const result = run(h, ["install", "claude-code", "--force"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refused");
    expect(readFileSync(claudeSkill(h), "utf8")).toBe("my own skill\n");
  }, 30_000);

  it("preflights every target before writing a global skill or MCP registration", () => {
    const h = home();
    writeFileSync(mcpState(h, "claude"), "/custom/hermes-action", "utf8");
    const result = run(h, ["install", "all"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("claude-code MCP: refused");
    expect(existsSync(claudeSkill(h))).toBe(false);
    expect(existsSync(codexSkill(h))).toBe(false);
    expect(existsSync(mcpState(h, "codex"))).toBe(false);
    expect(readFileSync(mcpState(h, "claude"), "utf8")).toBe("/custom/hermes-action");
  }, 30_000);

  it("rolls back earlier writes when a later skill cannot be written", () => {
    const h = home();
    writeFileSync(join(h, ".codex"), "blocked parent", "utf8");
    const result = run(h, ["install", "all"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refused");
    expect(existsSync(claudeSkill(h))).toBe(false);
    expect(readFileSync(join(h, ".codex"), "utf8")).toBe("blocked parent");
    expect(existsSync(mcpState(h, "claude"))).toBe(false);
    expect(existsSync(mcpState(h, "codex"))).toBe(false);
  }, 30_000);

  it("restores a stale managed skill when another target fails after --force", () => {
    const h = home();
    expect(run(h, ["install", "claude-code"]).status).toBe(0);
    const lock = JSON.parse(readFileSync(claudeLock(h), "utf8")) as { version: string };
    lock.version = "previous-template-version";
    const previousLock = `${JSON.stringify(lock, null, 2)}\n`;
    writeFileSync(claudeLock(h), previousLock, "utf8");
    writeFileSync(join(h, ".codex"), "blocked parent", "utf8");

    expect(run(h, ["install", "all", "--force"]).status).toBe(1);
    expect(readFileSync(claudeLock(h), "utf8")).toBe(previousLock);
    expect(existsSync(mcpState(h, "claude"))).toBe(true);
    expect(existsSync(mcpState(h, "codex"))).toBe(false);
  }, 30_000);

  it("restores existing project hints when a later hint write fails", () => {
    const h = home();
    const project = home();
    const claudeRules = join(project, "CLAUDE.md");
    const codexRules = join(project, "AGENTS.md");
    writeFileSync(claudeRules, "# Claude rules\n", "utf8");
    writeFileSync(codexRules, "# Codex rules\n", "utf8");
    chmodSync(codexRules, 0o444);

    expect(run(h, ["install", "all", "--project-hint"], project).status).toBe(1);
    expect(readFileSync(claudeRules, "utf8")).toBe("# Claude rules\n");
    expect(readFileSync(codexRules, "utf8")).toBe("# Codex rules\n");
    expect(existsSync(claudeSkill(h))).toBe(false);
    expect(existsSync(codexSkill(h))).toBe(false);
    expect(existsSync(mcpState(h, "claude"))).toBe(false);
    expect(existsSync(mcpState(h, "codex"))).toBe(false);
  }, 30_000);

  it("uninstalls the managed skills and MCP registrations", () => {
    const h = home();
    run(h, ["install", "all"]);
    expect(run(h, ["uninstall", "all"]).stdout).toContain("removed");
    expect(existsSync(claudeSkill(h))).toBe(false);
    expect(existsSync(mcpState(h, "claude"))).toBe(false);
    expect(existsSync(mcpState(h, "codex"))).toBe(false);
    expect(run(h, ["install", "mcp"]).stdout).toContain("codex MCP: created");
  }, 30_000);

  it("adds and removes a project hint without losing existing content", () => {
    const h = home();
    const project = home();
    writeFileSync(join(project, "CLAUDE.md"), "# My rules\n");
    run(h, ["install", "claude-code", "--project-hint"], project);
    const withHint = readFileSync(join(project, "CLAUDE.md"), "utf8");
    expect(withHint).toContain("# My rules");
    expect(withHint).toContain("hermes-action-bridge:start");
    run(h, ["uninstall", "claude-code", "--project-hint"], project);
    const afterRemoval = readFileSync(join(project, "CLAUDE.md"), "utf8");
    expect(afterRemoval).toContain("# My rules");
    expect(afterRemoval).not.toContain("hermes-action-bridge:start");
  }, 30_000);

  it("writes a project-scoped skill without creating the global one", () => {
    const h = home();
    const project = home();
    run(h, ["install", "claude-code", "--project"], project);
    expect(existsSync(join(project, ".claude", "skills", "hermes-action-bridge", "SKILL.md"))).toBe(true);
    expect(existsSync(claudeSkill(h))).toBe(false);
    expect(existsSync(mcpState(h, "claude"))).toBe(false);
  }, 30_000);

  it("merges and unmerges the project .mcp.json, preserving other servers", () => {
    const h = home();
    const project = home();
    writeFileSync(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }, null, 2));
    run(h, ["install", "mcp", "--write"], project);
    const merged = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8"));
    expect(merged.mcpServers.other).toBeDefined();
    expect(merged.mcpServers["hermes-action"]).toBeDefined();
    run(h, ["uninstall", "mcp", "--write"], project);
    const after = JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8"));
    expect(after.mcpServers["hermes-action"]).toBeUndefined();
    expect(after.mcpServers.other).toBeDefined();
  }, 30_000);
});
