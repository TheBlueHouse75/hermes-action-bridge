import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cli = join(process.cwd(), "src", "cli.ts");

function run(home: string, args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", cli, ...args], { env: { ...process.env, HOME: home }, encoding: "utf8", stdio: "pipe" });
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

  it("uninstalls a managed skill and defers unsupported targets", () => {
    const h = home();
    run(h, ["install", "all"]);
    expect(run(h, ["uninstall", "all"]).stdout).toContain("removed");
    expect(existsSync(claudeSkill(h))).toBe(false);
    expect(run(h, ["install", "mcp"]).stdout).toContain("Not available yet");
  }, 30_000);
});
