import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendAuditEvent, fingerprintPrompt } from "../src/audit-log.js";

describe("audit log", () => {
  it("writes an owner-only, restricted JSONL record without prompt or result data", () => {
    const file = join(mkdtempSync(join(tmpdir(), "hab-audit-")), "nested", "audit.jsonl");
    appendAuditEvent(file, {
      timestamp: "2026-01-01T00:00:00.000Z", phase: "completed", requestId: "job-1", principalId: "stdio",
      transport: "stdio", requestedMode: "execute", effectiveMode: "request-approval", presetName: "default",
      detectedRisks: ["publish_external"], promptFingerprint: fingerprintPrompt("secret prompt"), outcome: "succeeded", exitCode: 0,
    });
    const content = readFileSync(file, "utf8");
    expect(content).not.toContain("secret prompt");
    expect(JSON.parse(content)).toMatchObject({ requestId: "job-1", outcome: "succeeded" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
