import { describe, expect, it } from "vitest";
import { buildEffectiveRun } from "../src/run.js";
import { defaultConfig } from "../src/config.js";
import type { BridgeConfig, RunOptions } from "../src/types.js";

const config: BridgeConfig = {
  ...defaultConfig,
  presets: {
    default: { skills: [], toolsets: [] },
    trusted: { skills: [], toolsets: [], requireApprovalFor: [] },
  },
};

function options(overrides: Partial<RunOptions> = {}): RunOptions {
  return { prompt: "delete the old logs", mode: "execute", contextFiles: [], yolo: false, dryRun: false, json: false, ...overrides };
}

describe("buildEffectiveRun policy resolution", () => {
  it("downgrades execute to request-approval for a risky prompt under the global policy", () => {
    const run = buildEffectiveRun(config, options({ preset: "default" }));
    expect(run.detectedRisks).toContain("delete");
    expect(run.mode).toBe("request-approval");
  });

  it("keeps execute when a preset clears require_approval_for", () => {
    const run = buildEffectiveRun(config, options({ preset: "trusted" }));
    expect(run.detectedRisks).toContain("delete");
    expect(run.mode).toBe("execute");
  });

  it("resolves a per-mode timeout default when none is configured", () => {
    expect(buildEffectiveRun(config, options({ preset: "default", mode: "plan" })).timeoutSeconds).toBe(180);
    expect(buildEffectiveRun(config, options({ preset: "default", mode: "draft" })).timeoutSeconds).toBe(180);
  });
});
