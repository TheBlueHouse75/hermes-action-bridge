import { describe, expect, it } from "vitest";
import { buildHermesCliArgs } from "../src/adapters/hermes-cli.js";
import type { EffectiveRun } from "../src/types.js";

function run(overrides: Partial<EffectiveRun> = {}): EffectiveRun {
  return {
    mode: "plan",
    requestedMode: "plan",
    presetName: "default",
    preset: { skills: ["hermes-agent"], toolsets: ["terminal", "file"] },
    prompt: "Summarize this",
    source: "external-agent",
    maxTurns: 30,
    yolo: false,
    detectedRisks: [],
    contextDocuments: [],
    ...overrides,
  };
}

describe("Hermes CLI adapter", () => {
  it("builds a hermes chat command with skills and toolsets", () => {
    const args = buildHermesCliArgs(run());
    expect(args.slice(0, 2)).toEqual(["chat", "-Q"]);
    expect(args).toContain("--skills");
    expect(args).toContain("hermes-agent");
    expect(args).toContain("--toolsets");
    expect(args).toContain("terminal,file");
    expect(args).toContain("-q");
  });

  it("passes --yolo only when explicitly enabled", () => {
    expect(buildHermesCliArgs(run())).not.toContain("--yolo");
    expect(buildHermesCliArgs(run({ yolo: true }))).toContain("--yolo");
  });
});
