import type { BridgeConfig, BridgeMode, EffectiveRun, RunOptions } from "./types.js";
import { applyPolicy } from "./policy.js";
import { readContextFiles } from "./context.js";

/**
 * Per-mode timeout defaults (seconds): plan/draft are cheap; execute/request-approval may run real tools.
 * The timeout covers the whole session (chat -Q has no streaming), so defaults stay generous.
 */
function defaultTimeoutSeconds(mode: BridgeMode): number {
  return mode === "execute" || mode === "request-approval" ? 600 : 180;
}

export function buildEffectiveRun(config: BridgeConfig, options: RunOptions): EffectiveRun {
  const presetName = options.preset || config.defaults.preset;
  const preset = config.presets[presetName];
  if (!preset) throw new Error(`Unknown preset: ${presetName}`);
  const requestedMode = options.mode || config.defaults.mode;
  const yolo = options.yolo || config.policy.yolo;
  const decision = applyPolicy(requestedMode, config.policy, options.prompt, yolo);

  return {
    mode: decision.mode,
    requestedMode: decision.requestedMode,
    presetName,
    preset,
    prompt: options.prompt,
    source: options.source || preset.source || config.defaults.source,
    profile: options.profile || preset.profile || config.defaults.profile,
    provider: options.provider || preset.provider,
    model: options.model || preset.model,
    maxTurns: options.maxTurns || preset.maxTurns || config.defaults.maxTurns,
    yolo,
    detectedRisks: decision.detectedRisks,
    contextDocuments: readContextFiles(options.contextFiles, config.runtime.maxContextBytes),
    timeoutSeconds: options.timeoutSeconds ?? config.runtime.timeoutSeconds ?? defaultTimeoutSeconds(decision.mode),
  };
}
