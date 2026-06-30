import { join } from "node:path";
import { instructionFile, skillDir } from "./paths.js";
import { projectHint, skillMarkdown } from "./templates.js";
import { classifyBundle, removeBundle, writeBundle, type ManagedBundle } from "./managed-file.js";
import { removeBlock, upsertBlock } from "./marker-block.js";
import { applyFileEdit } from "./file-edit.js";
import type { FileChange, InstallOptions, InstallScope, ManagedState, PathContext, SkillAgent } from "./types.js";

export type SkillTarget = SkillAgent | "all";

export interface ServiceOptions extends InstallOptions {
  scope: InstallScope;
}

export interface TargetResult {
  agent: SkillAgent;
  ok: boolean;
  changes: FileChange[];
}

export interface SkillPreview {
  agent: SkillAgent;
  files: { path: string; content: string }[];
}

const allAgents: SkillAgent[] = ["claude-code", "codex"];

function agentsFor(target: SkillTarget): SkillAgent[] {
  return target === "all" ? allAgents : [target];
}

function bundleAt(dir: string): ManagedBundle {
  return { dir, files: { "SKILL.md": skillMarkdown() } };
}

function bundleFor(agent: SkillAgent, ctx: PathContext, scope: InstallScope): ManagedBundle {
  return bundleAt(skillDir(agent, ctx, scope));
}

/**
 * Run one filesystem operation per agent, isolating failures so one agent cannot abort the others.
 * The per-agent target path is resolved once and passed to `op`, and reused to report a thrown error.
 */
function perAgent(target: SkillTarget, pathOf: (agent: SkillAgent) => string, op: (path: string) => FileChange[]): TargetResult[] {
  return agentsFor(target).map((agent) => {
    const path = pathOf(agent);
    try {
      const changes = op(path);
      return { agent, ok: !changes.some((change) => change.action === "refused"), changes };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { agent, ok: false, changes: [{ path, action: "refused", reason }] };
    }
  });
}

export function installSkills(target: SkillTarget, ctx: PathContext, options: ServiceOptions): TargetResult[] {
  return perAgent(target, (agent) => skillDir(agent, ctx, options.scope), (dir) => writeBundle(bundleAt(dir), options));
}

export function uninstallSkills(target: SkillTarget, ctx: PathContext, options: ServiceOptions): TargetResult[] {
  return perAgent(target, (agent) => skillDir(agent, ctx, options.scope), (dir) => removeBundle(dir, options));
}

export function installHint(target: SkillTarget, ctx: PathContext, options: ServiceOptions): TargetResult[] {
  return perAgent(target, (agent) => instructionFile(agent, ctx), (file) => [
    applyFileEdit(file, (existing) => upsertBlock(existing, projectHint()), options.dryRun),
  ]);
}

export function uninstallHint(target: SkillTarget, ctx: PathContext, options: ServiceOptions): TargetResult[] {
  return perAgent(target, (agent) => instructionFile(agent, ctx), (file) => [
    applyFileEdit(file, (existing) => (existing === null ? { content: "", action: "unchanged" } : removeBlock(existing)), options.dryRun),
  ]);
}

export function previewSkills(target: SkillTarget, ctx: PathContext, scope: InstallScope): SkillPreview[] {
  return agentsFor(target).map((agent) => {
    const bundle = bundleFor(agent, ctx, scope);
    return { agent, files: Object.entries(bundle.files).map(([name, content]) => ({ path: join(bundle.dir, name), content })) };
  });
}

export function skillStates(ctx: PathContext, scope: InstallScope): { agent: SkillAgent; state: ManagedState }[] {
  return allAgents.map((agent) => ({ agent, state: classifyBundle(bundleFor(agent, ctx, scope)) }));
}
