import { randomUUID } from "node:crypto";
import type { EffectiveRun } from "./types.js";
import { positiveInteger } from "./validation.js";

export type ApprovalStatus = "awaiting_approval" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  status: ApprovalStatus;
  createdAt: string;
  expiresAt: string;
  requestedMode: EffectiveRun["requestedMode"];
  effectiveMode: EffectiveRun["mode"];
  presetName: string;
  detectedRisks: EffectiveRun["detectedRisks"];
}

export interface ConsumedApproval {
  approval: ApprovalRequest;
  run: EffectiveRun;
}

export interface ApprovalStoreOptions {
  ttlMs?: number | undefined;
  maxPending?: number | undefined;
  now?: () => Date;
  createId?: () => string;
  onExpired?: ((approval: ApprovalRequest) => void) | undefined;
}

export interface ApprovalStore {
  prepare(run: EffectiveRun): ApprovalRequest;
  get(approvalId: string): ApprovalRequest | undefined;
  approve(approvalId: string): ConsumedApproval | undefined;
  reject(approvalId: string): ApprovalRequest | undefined;
  cleanup(): number;
}

const defaultTtlMs = 15 * 60 * 1000;
const defaultMaxPending = 32;

interface StoredApproval {
  approval: ApprovalRequest;
  run: EffectiveRun;
}

/**
 * One-shot, in-process approvals. A stored run is returned exactly once by `approve`; callers must
 * execute that unchanged run rather than accepting new execution options at approval time.
 */
export function createApprovalStore(options: ApprovalStoreOptions = {}): ApprovalStore {
  const ttlMs = positiveInteger(options.ttlMs, defaultTtlMs, "ttlMs");
  const maxPending = positiveInteger(options.maxPending, defaultMaxPending, "maxPending");
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const onExpired = options.onExpired;
  const entries = new Map<string, StoredApproval>();

  const expire = (entry: StoredApproval, current: Date): void => {
    if (entry.approval.status === "awaiting_approval" && Date.parse(entry.approval.expiresAt) <= current.getTime()) {
      entry.approval.status = "expired";
    }
  };

  const cleanupExpired = (): number => {
    const current = now();
    let removed = 0;
    for (const [id, entry] of entries) {
      expire(entry, current);
      if (Date.parse(entry.approval.expiresAt) > current.getTime()) continue;
      if (entry.approval.status === "expired") {
        try {
          onExpired?.(structuredClone(entry.approval));
        } catch {
          // Expiration cleanup must not crash a long-lived bridge when best-effort telemetry fails.
        }
      }
      entries.delete(id);
      removed += 1;
    }
    return removed;
  };

  return {
    prepare(run) {
      cleanupExpired();
      if (entries.size >= maxPending) throw new Error(`Hermes approval store is full (${maxPending} pending)`);
      const created = now();
      const id = createId();
      if (entries.has(id)) throw new Error("Approval ID collision");
      const approval: ApprovalRequest = {
        id,
        status: "awaiting_approval",
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + ttlMs).toISOString(),
        requestedMode: run.requestedMode,
        effectiveMode: run.mode,
        presetName: run.presetName,
        detectedRisks: [...run.detectedRisks],
      };
      entries.set(id, { approval, run: structuredClone(run) });
      return structuredClone(approval);
    },
    get(approvalId) {
      const entry = entries.get(approvalId);
      if (!entry) return undefined;
      expire(entry, now());
      return structuredClone(entry.approval);
    },
    approve(approvalId) {
      const entry = entries.get(approvalId);
      if (!entry) return undefined;
      expire(entry, now());
      if (entry.approval.status !== "awaiting_approval") return undefined;
      entry.approval.status = "approved";
      const consumed = { approval: structuredClone(entry.approval), run: structuredClone(entry.run) };
      entries.delete(approvalId);
      return consumed;
    },
    reject(approvalId) {
      const entry = entries.get(approvalId);
      if (!entry) return undefined;
      expire(entry, now());
      if (entry.approval.status === "awaiting_approval") entry.approval.status = "rejected";
      const rejected = structuredClone(entry.approval);
      entries.delete(approvalId);
      return rejected;
    },
    cleanup: cleanupExpired,
  };
}
