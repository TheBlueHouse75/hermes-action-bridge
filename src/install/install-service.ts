import { join } from "node:path";
import { skillDir } from "./paths.js";
import { skillMarkdown } from "./templates.js";
import { removeBundle, writeBundle, type ManagedBundle } from "./managed-file.js";
import type { FileChange, InstallOptions, InstallScope, PathContext, SkillAgent } from "./types.js";

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

function bundleFor(agent: SkillAgent, ctx: PathContext, scope: InstallScope): ManagedBundle {
  return { dir: skillDir(agent, ctx, scope), files: { "SKILL.md": skillMarkdown() } };
}

/** Run one filesystem operation per agent, isolating failures so one agent cannot abort the others. */
function perAgent(target: SkillTarget, ctx: PathContext, scope: InstallScope, run: (b: ManagedBundle) => FileChange[]): TargetResult[] {
  return agentsFor(target).map((agent) => {
    const bundle = bundleFor(agent, ctx, scope);
    try {
      const changes = run(bundle);
      return { agent, ok: !changes.some((change) => change.action === "refused"), changes };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { agent, ok: false, changes: [{ path: bundle.dir, action: "refused", reason }] };
    }
  });
}

export function installSkills(target: SkillTarget, ctx: PathContext, options: ServiceOptions): TargetResult[] {
  return perAgent(target, ctx, options.scope, (bundle) => writeBundle(bundle, options));
}

export function uninstallSkills(target: SkillTarget, ctx: PathContext, options: ServiceOptions): TargetResult[] {
  return perAgent(target, ctx, options.scope, (bundle) => removeBundle(bundle.dir, options));
}

export function previewSkills(target: SkillTarget, ctx: PathContext, scope: InstallScope): SkillPreview[] {
  return agentsFor(target).map((agent) => {
    const bundle = bundleFor(agent, ctx, scope);
    return { agent, files: Object.entries(bundle.files).map(([name, content]) => ({ path: join(bundle.dir, name), content })) };
  });
}
