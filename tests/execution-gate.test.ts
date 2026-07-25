import { describe, expect, it } from "vitest";
import { createExecutionGate } from "../src/execution-gate.js";

describe("execution gate", () => {
  it("rejects excess direct work and releases capacity after settlement", async () => {
    let release!: () => void;
    const gate = createExecutionGate(1);
    const running = gate.run(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    await expect(gate.run(async () => undefined)).rejects.toThrow("execution limit reached");
    release();
    await running;
    await expect(gate.run(async () => "done")).resolves.toBe("done");
  });
});
