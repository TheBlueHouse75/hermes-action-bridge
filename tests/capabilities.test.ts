import { describe, expect, it } from "vitest";
import { getBridgeCapabilities } from "../src/capabilities.js";
import { defaultConfig } from "../src/config.js";

describe("bridge capabilities", () => {
  it("reports only declarative presets when live Hermes discovery is unavailable", () => {
    const config = {
      ...defaultConfig,
      runtime: { ...defaultConfig.runtime, command: "definitely-not-a-hermes-binary" },
      presets: { coding: { description: "Code", skills: ["runtime-debugging"], toolsets: ["terminal"] } },
    };
    const capabilities = getBridgeCapabilities(config, "http");
    expect(capabilities.bridge.transport).toBe("http");
    expect(capabilities.runtime.available).toBe(false);
    expect(capabilities.presets).toEqual([expect.objectContaining({ name: "coding", skills: ["runtime-debugging"] })]);
    expect(capabilities.liveDiscovery.supported).toBe(false);
  });
});
