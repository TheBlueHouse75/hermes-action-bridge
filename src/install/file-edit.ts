import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { FileChange } from "./types.js";

export interface EditResult {
  content: string;
  action: FileChange["action"];
  reason?: string | undefined;
}

/**
 * Read a file (or null when absent), apply a pure edit, and write only when it actually changes.
 * Total: a filesystem error (permission, race) is reported as a refused change rather than thrown,
 * so callers that are not already wrapped in per-item isolation stay graceful.
 */
export function applyFileEdit(file: string, edit: (existing: string | null) => EditResult, dryRun: boolean): FileChange {
  try {
    const result = edit(existsSync(file) ? readFileSync(file, "utf8") : null);
    if (result.action !== "unchanged" && result.action !== "refused" && !dryRun) writeFileSync(file, result.content, "utf8");
    return { path: file, action: result.action, reason: result.reason };
  } catch (error) {
    return { path: file, action: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
}
