import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BridgeMode, RiskCategory } from "./types.js";

export type AuditPhase = "prepared" | "approved" | "rejected" | "submitted" | "completed" | "cancelled" | "expired";

/** Deliberately narrow: prompts, context, tool output, credentials and bearer tokens are not representable. */
export interface AuditEvent {
  timestamp: string;
  phase: AuditPhase;
  requestId: string;
  principalId: string;
  transport: "stdio" | "http";
  requestedMode: BridgeMode;
  effectiveMode: BridgeMode;
  presetName: string;
  detectedRisks: RiskCategory[];
  promptFingerprint: string;
  exitCode?: number | undefined;
  outcome?: "succeeded" | "failed" | "cancelled" | "timed_out" | undefined;
}

/** SHA-256 lets related events be correlated without retaining the private handoff. */
export function fingerprintPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

/** Append a restricted audit record as a single JSONL line. The directory and file are owner-only. */
export function appendAuditEvent(file: string, event: AuditEvent): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const line = `${JSON.stringify(sanitizeEvent(event))}\n`;
  appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

function sanitizeEvent(event: AuditEvent): AuditEvent {
  return {
    timestamp: event.timestamp,
    phase: event.phase,
    requestId: event.requestId,
    principalId: event.principalId,
    transport: event.transport,
    requestedMode: event.requestedMode,
    effectiveMode: event.effectiveMode,
    presetName: event.presetName,
    detectedRisks: [...event.detectedRisks],
    promptFingerprint: event.promptFingerprint,
    ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }),
    ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
  };
}
