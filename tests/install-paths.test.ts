import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { instructionFile, skillDir, skillName } from "../src/install/paths.js";
import type { PathContext } from "../src/install/types.js";

const ctx: PathContext = { homeDir: join("/home", "user"), cwd: join("/work", "project") };

describe("install paths", () => {
  it("resolves global skill dirs under the home directory", () => {
    expect(skillDir("claude-code", ctx, "global")).toBe(join(ctx.homeDir, ".claude", "skills", skillName));
    expect(skillDir("codex", ctx, "global")).toBe(join(ctx.homeDir, ".codex", "skills", skillName));
  });

  it("resolves project skill dirs under the working directory", () => {
    expect(skillDir("claude-code", ctx, "project")).toBe(join(ctx.cwd, ".claude", "skills", skillName));
    expect(skillDir("codex", ctx, "project")).toBe(join(ctx.cwd, ".codex", "skills", skillName));
  });

  it("resolves instruction files against the working directory", () => {
    expect(instructionFile("claude-code", ctx)).toBe(join(ctx.cwd, "CLAUDE.md"));
    expect(instructionFile("codex", ctx)).toBe(join(ctx.cwd, "AGENTS.md"));
  });
});
