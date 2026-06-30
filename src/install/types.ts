export type SkillAgent = "claude-code" | "codex";
export type InstallTarget = SkillAgent | "all" | "mcp";
export type InstallScope = "global" | "project";

export type ManagedState = "absent" | "current" | "stale" | "user-modified" | "foreign";

export type FileAction = "created" | "updated" | "unchanged" | "removed" | "refused";

export interface FileChange {
  path: string;
  action: FileAction;
  reason?: string | undefined;
}

export interface PathContext {
  homeDir: string;
  cwd: string;
}

export interface InstallOptions {
  force: boolean;
  dryRun: boolean;
}
