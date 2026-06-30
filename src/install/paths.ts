import { join } from "node:path";
import type { InstallScope, PathContext, SkillAgent } from "./types.js";

export const skillName = "hermes-action-bridge";

const agentConfigDir: Record<SkillAgent, string> = {
  "claude-code": ".claude",
  codex: ".codex",
};

const agentInstructionFile: Record<SkillAgent, string> = {
  "claude-code": "CLAUDE.md",
  codex: "AGENTS.md",
};

function scopeRoot(ctx: PathContext, scope: InstallScope): string {
  return scope === "global" ? ctx.homeDir : ctx.cwd;
}

/** Directory that holds the bridge skill for an agent, e.g. `~/.claude/skills/hermes-action-bridge`. */
export function skillDir(agent: SkillAgent, ctx: PathContext, scope: InstallScope): string {
  return join(scopeRoot(ctx, scope), agentConfigDir[agent], "skills", skillName);
}

/** Project instruction file for an agent (`CLAUDE.md` or `AGENTS.md`), always resolved against the project cwd. */
export function instructionFile(agent: SkillAgent, ctx: PathContext): string {
  return join(ctx.cwd, agentInstructionFile[agent]);
}
