import { spawnSync } from "node:child_process";
import type { BridgeConfig } from "./types.js";

/** Quick liveness probe for a tool's `--version` — a short fixed cap, distinct from the configurable per-run timeout. */
export const versionProbeTimeoutMs = 5000;

export interface StatusResult {
  command: string;
  available: boolean;
  version?: string;
  error?: string;
}

export function checkHermesStatus(config: BridgeConfig): StatusResult {
  const result = spawnSync(config.runtime.command, ["--version"], { encoding: "utf8", timeout: versionProbeTimeoutMs });
  if (result.error) return { command: config.runtime.command, available: false, error: result.error.message };
  if (result.status !== 0) return { command: config.runtime.command, available: false, error: result.stderr.trim() || `exit ${result.status}` };
  return { command: config.runtime.command, available: true, version: result.stdout.trim() };
}
