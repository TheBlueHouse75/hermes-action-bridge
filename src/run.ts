import type { BridgeConfig, EffectiveRun, RunOptions } from "./types.js";
import { applyPolicy } from "./policy.js";
import { readContextFiles } from "./context.js";

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
  };
}
