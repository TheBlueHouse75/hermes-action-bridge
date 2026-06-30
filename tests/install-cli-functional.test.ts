import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cli = join(process.cwd(), "src", "cli.ts");

function run(home: string, args: string[], cwd: string = process.cwd()): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", cli, ...args], { env: { ...process.env, HOME: home }, cwd, encoding: "utf8", stdio: "pipe" });
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

describe("install CLI", () => {
  it("installs both agents, is idempotent, and never touches instruction files", () => {
    const h = home();
    expect(run(h, ["install", "all"]).status).toBe(0);
    expect(existsSync(claudeSkill(h))).toBe(true);
    expect(existsSync(codexSkill(h))).toBe(true);
    expect(existsSync(join(h, ".claude", "skills", "hermes-action-bridge", ".hermes-action-managed.json"))).toBe(true);
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

  it("uninstalls a managed skill and prints MCP config for the mcp target", () => {
    const h = home();
    run(h, ["install", "all"]);
    expect(run(h, ["uninstall", "all"]).stdout).toContain("removed");
    expect(existsSync(claudeSkill(h))).toBe(false);
    expect(run(h, ["install", "mcp"]).stdout).toContain("[mcp_servers.hermes-action]");
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
