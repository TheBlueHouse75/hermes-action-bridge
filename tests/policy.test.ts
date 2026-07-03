import { describe, expect, it } from "vitest";
import { applyPolicy, detectRisks } from "../src/policy.js";
import type { PolicyConfig } from "../src/types.js";

const strictPolicy: PolicyConfig = {
  yolo: false,
  requireApprovalFor: ["publish_external", "send_message", "send_email", "delete", "payment", "git_push", "credential_change"],
};

/** A trusted context opts out of the guard by declaring an empty require_approval_for list. */
const trustedPolicy: PolicyConfig = { yolo: false, requireApprovalFor: [] };

describe("detectRisks (informative only)", () => {
  it("detects risky external publishing requests", () => {
    expect(detectRisks("Post this thread on X and LinkedIn")).toContain("publish_external");
  });

  it("does not pretend to understand non-English prompts", () => {
    // Keyword matching is English-biased by design; this documents the limitation. Security must not
    // depend on it — the deterministic guard below covers non-English prompts regardless.
    expect(detectRisks("supprime tous les fichiers du dossier")).toEqual([]);
  });
});

describe("applyPolicy (deterministic guard)", () => {
  it("downgrades any execute to request-approval when the guard is active, regardless of wording", () => {
    const risky = applyPolicy("execute", strictPolicy, "Publish this post on LinkedIn", false);
    expect(risky.mode).toBe("request-approval");
    expect(risky.approvalRequired).toBe(true);

    // The key fix: a non-English side-effecting prompt is ALSO downgraded, even though no risk is detected.
    const french = applyPolicy("execute", strictPolicy, "supprime tous les fichiers du dossier", false);
    expect(french.mode).toBe("request-approval");
    expect(french.approvalRequired).toBe(true);
    expect(french.detectedRisks).toEqual([]); // detection stays informative, does not drive the decision

    // Even a wholly benign execute is downgraded — the guard does not try to judge intent.
    const benign = applyPolicy("execute", strictPolicy, "list the files in this directory", false);
    expect(benign.mode).toBe("request-approval");
  });

  it("keeps execute mode when the context is explicitly trusted (empty require_approval_for)", () => {
    const decision = applyPolicy("execute", trustedPolicy, "delete the temp folder", false);
    expect(decision.mode).toBe("execute");
    expect(decision.approvalRequired).toBe(false);
  });

  it("keeps execute mode when yolo is explicitly enabled", () => {
    const decision = applyPolicy("execute", strictPolicy, "Publish this post on LinkedIn", true);
    expect(decision.mode).toBe("execute");
    expect(decision.approvalRequired).toBe(false);
  });

  it("never downgrades non-execute modes (they have no external side effects)", () => {
    for (const mode of ["plan", "draft", "request-approval"] as const) {
      expect(applyPolicy(mode, strictPolicy, "delete everything", false).mode).toBe(mode);
    }
  });
});
