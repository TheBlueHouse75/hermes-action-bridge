import { describe, expect, it } from "vitest";
import { createApprovalStore } from "../src/approvals.js";
import type { EffectiveRun } from "../src/types.js";

function effectiveRun(): EffectiveRun {
  return {
    mode: "request-approval", requestedMode: "execute", presetName: "default", preset: { skills: [], toolsets: [] },
    prompt: "publish private content", source: "test", maxTurns: 1, yolo: false, detectedRisks: ["publish_external"], contextDocuments: [], timeoutSeconds: 1,
  };
}

describe("approval store", () => {
  it("approves a preserved run exactly once", () => {
    const store = createApprovalStore({ createId: () => "approval-1" });
    const prepared = store.prepare(effectiveRun());
    expect(JSON.stringify(prepared)).not.toContain("private content");
    expect(store.getPendingRun(prepared.id)?.prompt).toBe("publish private content");
    const consumed = store.approve(prepared.id);
    expect(consumed?.run.prompt).toBe("publish private content");
    expect(consumed?.approval.status).toBe("approved");
    expect(store.getPendingRun(prepared.id)).toBeUndefined();
    expect(store.approve(prepared.id)).toBeUndefined();
  });

  it("expires approvals before they can be approved", () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const expired: string[] = [];
    const store = createApprovalStore({
      ttlMs: 10,
      now: () => clock,
      createId: () => "approval-2",
      onExpired: (approval) => expired.push(approval.id),
    });
    store.prepare(effectiveRun());
    clock = new Date("2026-01-01T00:00:00.010Z");
    expect(store.get("approval-2")?.status).toBe("expired");
    expect(store.approve("approval-2")).toBeUndefined();
    expect(store.cleanup()).toBe(1);
    expect(expired).toEqual(["approval-2"]);
  });

  it("bounds pending approvals and releases capacity when one is consumed", () => {
    let nextId = 0;
    const store = createApprovalStore({
      maxPending: 1,
      createId: () => `approval-cap-${++nextId}`,
    });
    const first = store.prepare(effectiveRun());
    expect(() => store.prepare(effectiveRun())).toThrow("approval store is full");
    expect(store.approve(first.id)?.approval.status).toBe("approved");
    expect(store.get(first.id)).toBeUndefined();
    expect(store.prepare(effectiveRun()).id).toBe("approval-cap-2");
  });
});
