import { checkHermesStatus } from "./status.js";
import { version } from "./version.js";
import type { BridgeConfig, PresetConfig } from "./types.js";

export interface BridgeCapabilities {
  bridge: { version: string; transport: "stdio" | "http" };
  runtime: { available: boolean; command: string; version?: string | undefined; error?: string | undefined };
  presets: Array<{ name: string } & PresetConfig>;
  policy: { yoloEnabled: boolean; approvalRequiredForExecute: boolean };
  liveDiscovery: { supported: false; reason: string };
}

/**
 * Return only configuration-backed capabilities. Hermes CLI has no stable discovery contract here, so
 * this deliberately never claims that a configured skill or toolset is live on the current runtime.
 */
export function getBridgeCapabilities(config: BridgeConfig, transport: "stdio" | "http" = "stdio"): BridgeCapabilities {
  const status = checkHermesStatus(config);
  return {
    bridge: { version, transport },
    runtime: {
      available: status.available,
      command: config.runtime.command,
      ...(status.available ? { version: status.version } : { error: status.error }),
    },
    presets: Object.entries(config.presets).map(([name, preset]) => ({ name, ...structuredClone(preset) })),
    policy: { yoloEnabled: config.policy.yolo, approvalRequiredForExecute: config.policy.requireApprovalFor.length > 0 },
    liveDiscovery: {
      supported: false,
      reason: "Hermes CLI capability discovery is not configured; presets are declarative rather than a live inventory.",
    },
  };
}
