import { describe, expect, it } from "vitest";
import { applyPolicy, detectRisks } from "../src/policy.js";
import type { PolicyConfig } from "../src/types.js";

const strictPolicy: PolicyConfig = {
  yolo: false,
  requireApprovalFor: ["publish_external", "send_message", "send_email", "delete", "payment", "git_push", "credential_change"],
};

describe("policy", () => {
  it("detects risky external publishing requests", () => {
    expect(detectRisks("Post this thread on X and LinkedIn")).toContain("publish_external");
  });

  it("downgrades execute to request-approval when risk is detected", () => {
    const decision = applyPolicy("execute", strictPolicy, "Publish this post on LinkedIn", false);
    expect(decision.mode).toBe("request-approval");
    expect(decision.approvalRequired).toBe(true);
  });

  it("keeps execute mode when yolo is explicitly enabled", () => {
    const decision = applyPolicy("execute", strictPolicy, "Publish this post on LinkedIn", true);
    expect(decision.mode).toBe("execute");
    expect(decision.approvalRequired).toBe(false);
  });
});
