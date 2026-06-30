import { spawnSync } from "node:child_process";
import type { BridgeConfig } from "./types.js";

export interface StatusResult {
  command: string;
  available: boolean;
  version?: string;
  error?: string;
}

export function checkHermesStatus(config: BridgeConfig): StatusResult {
  const result = spawnSync(config.runtime.command, ["--version"], { encoding: "utf8" });
  if (result.error) return { command: config.runtime.command, available: false, error: result.error.message };
  if (result.status !== 0) return { command: config.runtime.command, available: false, error: result.stderr.trim() || `exit ${result.status}` };
  return { command: config.runtime.command, available: true, version: result.stdout.trim() };
}
