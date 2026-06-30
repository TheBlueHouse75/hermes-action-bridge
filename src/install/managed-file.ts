import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentVersion } from "./templates.js";
import type { FileChange, InstallOptions, ManagedState } from "./types.js";

/**
 * Provenance lockfile written alongside the managed content. Its presence marks the directory as
 * ours; the recorded per-file hashes detect later hand-edits, and `version` detects template drift.
 */
const lockName = ".hermes-action-managed.json";

interface ManagedLock {
  version: string;
  files: Record<string, string>;
}

export interface ManagedBundle {
  dir: string;
  /** Filename (relative to `dir`) -> file content. */
  files: Record<string, string>;
}

function hashFiles(files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([name, content]) => [name, contentVersion(content)]));
}

function versionFromHashes(hashes: Record<string, string>): string {
  const canonical = Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return contentVersion(JSON.stringify(canonical));
}

function bundleVersion(files: Record<string, string>): string {
  return versionFromHashes(hashFiles(files));
}

function readLock(dir: string): ManagedLock | null {
  const lockPath = join(dir, lockName);
  if (!existsSync(lockPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    const lock = parsed as Partial<ManagedLock>;
    if (typeof lock.version !== "string" || typeof lock.files !== "object" || lock.files === null) return null;
    const files = lock.files as Record<string, unknown>;
    if (!Object.values(files).every((value) => typeof value === "string")) return null;
    return { version: lock.version, files: files as Record<string, string> };
  } catch {
    return null;
  }
}

/** Inspection helpers never throw: an unreadable file is reported as "not matching" rather than crashing. */
function diskHash(path: string): string | null {
  try {
    return contentVersion(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function dirHasEntries(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** True when every file recorded in the lock is still on disk with its recorded content. */
function lockIntact(dir: string, lock: ManagedLock): boolean {
  return Object.entries(lock.files).every(([name, hash]) => diskHash(join(dir, name)) === hash);
}

export function classifyBundle(bundle: ManagedBundle): ManagedState {
  const lock = readLock(bundle.dir);
  if (lock) {
    if (!lockIntact(bundle.dir, lock)) return "user-modified";
    return lock.version === bundleVersion(bundle.files) ? "current" : "stale";
  }
  // No readable lock: a present-but-unparseable lockfile, or any of our content files, means
  // something we did not write is here -> refuse (foreign). An empty directory means absent.
  const lockFilePresent = existsSync(join(bundle.dir, lockName));
  const anyContentPresent = Object.keys(bundle.files).some((name) => existsSync(join(bundle.dir, name)));
  return lockFilePresent || anyContentPresent ? "foreign" : "absent";
}

// Write-path failures (permission denied, disk full) intentionally propagate to the caller, which
// reports them per target; only best-effort directory cleanup is swallowed.
function atomicWrite(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.hab-tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);
}

function writeBundleFiles(bundle: ManagedBundle): void {
  const previous = readLock(bundle.dir);
  const hashes = hashFiles(bundle.files);
  for (const [name, content] of Object.entries(bundle.files)) {
    atomicWrite(join(bundle.dir, name), content);
  }
  const lock: ManagedLock = { version: versionFromHashes(hashes), files: hashes };
  atomicWrite(join(bundle.dir, lockName), `${JSON.stringify(lock, null, 2)}\n`);
  removeDroppedFiles(bundle.dir, previous, bundle.files);
}

/** Delete files recorded by a previous version that the current bundle no longer ships. */
function removeDroppedFiles(dir: string, previous: ManagedLock | null, current: Record<string, string>): void {
  if (!previous) return;
  for (const name of Object.keys(previous.files)) {
    if (name in current) continue;
    const path = join(dir, name);
    if (existsSync(path)) unlinkSync(path);
  }
}

function changes(bundle: ManagedBundle, action: "created" | "updated" | "unchanged"): FileChange[] {
  return Object.keys(bundle.files).map((name) => ({ path: join(bundle.dir, name), action }));
}

function refusal(dir: string, reason: string): FileChange[] {
  return [{ path: dir, action: "refused", reason }];
}

export function writeBundle(bundle: ManagedBundle, options: InstallOptions): FileChange[] {
  const state = classifyBundle(bundle);
  if (state === "current") return changes(bundle, "unchanged");
  if (state === "foreign") {
    return refusal(bundle.dir, `a non-managed file already exists in ${bundle.dir}; refusing to overwrite`);
  }
  if ((state === "stale" || state === "user-modified") && !options.force) {
    const why = state === "stale" ? "is out of date" : "was modified locally";
    return refusal(bundle.dir, `the installed skill ${why}; re-run with --force to overwrite`);
  }
  const action = state === "absent" ? "created" : "updated";
  if (!options.dryRun) writeBundleFiles(bundle);
  return changes(bundle, action);
}

export function removeBundle(dir: string, options: InstallOptions): FileChange[] {
  const lock = readLock(dir);
  if (!lock) {
    if (dirHasEntries(dir)) return refusal(dir, `${dir} is not a managed skill; refusing to remove`);
    return [];
  }
  if (!lockIntact(dir, lock) && !options.force) {
    return refusal(dir, `the installed skill was modified locally; re-run with --force to remove`);
  }
  if (!options.dryRun) removeBundleFiles(dir, lock);
  return [{ path: dir, action: "removed" }];
}

function removeBundleFiles(dir: string, lock: ManagedLock): void {
  for (const name of Object.keys(lock.files)) {
    const path = join(dir, name);
    if (existsSync(path)) unlinkSync(path);
  }
  const lockPath = join(dir, lockName);
  if (existsSync(lockPath)) unlinkSync(lockPath);
  if (!dirHasEntries(dir)) {
    try {
      rmdirSync(dir);
    } catch {
      // Best effort: leaving an empty directory behind is harmless.
    }
  }
}
