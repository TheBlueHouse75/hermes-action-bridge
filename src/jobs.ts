import { randomUUID } from "node:crypto";
import type { HermesCliExecution } from "./adapters/hermes-cli.js";
import type { AdapterResult, EffectiveRun } from "./types.js";
import { positiveInteger } from "./validation.js";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";

export interface JobOutput {
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface BridgeJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  startBefore?: string | undefined;
  expiresAt: string;
  requestedMode: EffectiveRun["requestedMode"];
  effectiveMode: EffectiveRun["mode"];
  presetName: string;
  detectedRisks: EffectiveRun["detectedRisks"];
  exitCode?: number | undefined;
  output?: JobOutput | undefined;
}

export interface JobStoreOptions {
  ttlMs?: number | undefined;
  maxOutputBytes?: number | undefined;
  maxConcurrent?: number | undefined;
  maxQueued?: number | undefined;
  now?: () => Date;
  createId?: () => string;
  onSettled?: ((job: BridgeJob) => void) | undefined;
}

export interface JobStore {
  submit(run: EffectiveRun, options?: JobSubmitOptions): BridgeJob;
  canSubmit(): boolean;
  get(jobId: string): BridgeJob | undefined;
  cancel(jobId: string): BridgeJob | undefined;
  cleanup(): number;
  shutdown(): Promise<void>;
}

export interface JobSubmitOptions {
  beforeStart?: ((job: BridgeJob) => void) | undefined;
  startBefore?: string | undefined;
}

export type StartExecution = (run: EffectiveRun) => HermesCliExecution;

const defaultTtlMs = 24 * 60 * 60 * 1000;
export const defaultJobMaxOutputBytes = 256 * 1024;
const defaultMaxConcurrent = 4;
const defaultMaxQueued = 32;

/**
 * In-process job storage for long-running Hermes requests. It intentionally keeps no prompt or context
 * document after starting the child process, so a status endpoint cannot expose handoff data.
 */
export function createJobStore(startExecution: StartExecution, options: JobStoreOptions = {}): JobStore {
  const ttlMs = positiveInteger(options.ttlMs, defaultTtlMs, "ttlMs");
  const maxOutputBytes = positiveInteger(options.maxOutputBytes, defaultJobMaxOutputBytes, "maxOutputBytes");
  const maxConcurrent = positiveInteger(options.maxConcurrent, defaultMaxConcurrent, "maxConcurrent");
  const maxQueued = positiveInteger(options.maxQueued, defaultMaxQueued, "maxQueued");
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const onSettled = options.onSettled;
  const jobs = new Map<string, BridgeJob>();
  const executions = new Map<string, HermesCliExecution>();
  const queuedRuns = new Map<string, { run: EffectiveRun; beforeStart?: ((job: BridgeJob) => void) | undefined }>();
  const queue: string[] = [];
  const cancelRequested = new Set<string>();
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | undefined;

  const snapshot = (job: BridgeJob): BridgeJob => structuredClone(job);
  const notifySettled = (job: BridgeJob): void => {
    try {
      onSettled?.(snapshot(job));
    } catch {
      // Job settlement must not become an unhandled rejection when best-effort telemetry fails.
    }
  };
  const startNext = (): void => {
    if (shuttingDown) return;
    while (executions.size < maxConcurrent) {
      const id = queue.shift();
      if (!id) return;
      const job = jobs.get(id);
      const queued = queuedRuns.get(id);
      if (!job || !queued || job.status !== "queued") continue;
      queuedRuns.delete(id);
      if (Date.parse(job.startBefore ?? job.expiresAt) <= now().getTime()) {
        job.status = "timed_out";
        job.finishedAt = now().toISOString();
        notifySettled(job);
        continue;
      }
      let execution: HermesCliExecution;
      try {
        queued.beforeStart?.(snapshot(job));
        job.status = "running";
        job.startedAt = now().toISOString();
        execution = startExecution(queued.run);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        settleJob(jobs, executions, cancelRequested, id, failedResult(message), now, maxOutputBytes);
        notifySettled(job);
        continue;
      }
      executions.set(id, execution);
      void execution.result.then(
        (result) => {
          settleJob(jobs, executions, cancelRequested, id, result, now, maxOutputBytes);
          notifySettled(job);
          startNext();
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          settleJob(jobs, executions, cancelRequested, id, failedResult(message), now, maxOutputBytes);
          notifySettled(job);
          startNext();
        },
      );
    }
  };

  const cleanupExpired = (): number => {
    const current = now().getTime();
    let removed = 0;
    for (const [id, job] of jobs) {
      if (job.status === "running") continue;
      const retentionExpired = Date.parse(job.expiresAt) <= current;
      const queuedStartExpired = job.status === "queued"
        && job.startBefore !== undefined
        && Date.parse(job.startBefore) <= current;
      if (!retentionExpired && !queuedStartExpired) continue;
      if (job.status === "queued") {
        job.status = "timed_out";
        job.finishedAt = now().toISOString();
        notifySettled(job);
      } else if (!isTerminal(job.status)) {
        continue;
      }
      jobs.delete(id);
      executions.delete(id);
      queuedRuns.delete(id);
      removeQueuedId(queue, id);
      cancelRequested.delete(id);
      removed += 1;
    }
    return removed;
  };

  return {
    submit(run, submitOptions = {}) {
      if (shuttingDown) throw new Error("Job store is shutting down");
      cleanupExpired();
      if (queuedRuns.size >= maxQueued) throw new Error(`Hermes job queue is full (${maxQueued} waiting)`);
      const created = now();
      const startBefore = submitOptions.startBefore === undefined ? undefined : Date.parse(submitOptions.startBefore);
      if (startBefore !== undefined && (!Number.isFinite(startBefore) || startBefore <= created.getTime())) {
        throw new Error("Hermes job start deadline has elapsed or is invalid");
      }
      const id = createId();
      if (jobs.has(id)) throw new Error("Job ID collision");
      const job: BridgeJob = {
        id,
        status: "queued",
        createdAt: created.toISOString(),
        ...(submitOptions.startBefore === undefined ? {} : { startBefore: submitOptions.startBefore }),
        expiresAt: new Date(created.getTime() + ttlMs).toISOString(),
        requestedMode: run.requestedMode,
        effectiveMode: run.mode,
        presetName: run.presetName,
        detectedRisks: [...run.detectedRisks],
      };
      jobs.set(id, job);
      queuedRuns.set(id, { run: structuredClone(run), beforeStart: submitOptions.beforeStart });
      queue.push(id);
      startNext();
      return snapshot(job);
    },
    canSubmit() {
      cleanupExpired();
      return !shuttingDown && queuedRuns.size < maxQueued;
    },
    get(jobId) {
      cleanupExpired();
      const job = jobs.get(jobId);
      return job ? snapshot(job) : undefined;
    },
    cancel(jobId) {
      cleanupExpired();
      const job = jobs.get(jobId);
      const execution = executions.get(jobId);
      if (!job) return undefined;
      if (isTerminal(job.status)) return snapshot(job);
      if (job.status === "queued") {
        queuedRuns.delete(jobId);
        removeQueuedId(queue, jobId);
        job.status = "cancelled";
        job.finishedAt = now().toISOString();
        notifySettled(job);
        return snapshot(job);
      }
      if (cancelRequested.has(jobId)) return snapshot(job);
      if (!execution || !execution.cancel()) return snapshot(job);
      cancelRequested.add(jobId);
      return snapshot(job);
    },
    cleanup: cleanupExpired,
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      shuttingDown = true;
      for (const id of [...queuedRuns.keys()]) {
        const job = jobs.get(id);
        queuedRuns.delete(id);
        removeQueuedId(queue, id);
        if (!job || job.status !== "queued") continue;
        job.status = "cancelled";
        job.finishedAt = now().toISOString();
        notifySettled(job);
      }
      const active = [...executions.entries()];
      for (const [id, execution] of active) {
        if (cancelRequested.has(id)) continue;
        if (execution.cancel()) cancelRequested.add(id);
      }
      shutdownPromise = Promise.allSettled(active.map(([, execution]) => execution.result)).then(() => undefined);
      return shutdownPromise;
    },
  };
}

function settleJob(
  jobs: Map<string, BridgeJob>,
  executions: Map<string, HermesCliExecution>,
  cancelRequested: Set<string>,
  jobId: string,
  result: AdapterResult,
  now: () => Date,
  maxOutputBytes: number,
): void {
  const job = jobs.get(jobId);
  if (!job || isTerminal(job.status)) return;
  job.status = cancelRequested.has(jobId) ? "cancelled" : result.timedOut ? "timed_out" : result.ok ? "succeeded" : "failed";
  job.finishedAt = now().toISOString();
  job.exitCode = result.exitCode;
  job.output = boundedOutput(result, maxOutputBytes);
  executions.delete(jobId);
  cancelRequested.delete(jobId);
}

function boundedOutput(result: AdapterResult, maxBytes: number): JobOutput {
  const stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
  const stderrBytes = Buffer.byteLength(result.stderr, "utf8");
  if (stdoutBytes + stderrBytes <= maxBytes) {
    return { stdout: result.stdout, stderr: result.stderr, truncated: result.outputTruncated === true };
  }
  const stdout = truncateUtf8(result.stdout, maxBytes);
  const remainingBytes = maxBytes - Buffer.byteLength(stdout, "utf8");
  return { stdout, stderr: truncateUtf8(result.stderr, remainingBytes), truncated: true };
}

/** Avoid cutting a multi-byte character, which could otherwise exceed the byte cap after replacement decoding. */
function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let used = 0;
  for (const char of value) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (used + bytes > maxBytes) break;
    result += char;
    used += bytes;
  }
  return result;
}

function failedResult(message: string): AdapterResult {
  return { ok: false, exitCode: 1, stdout: "", stderr: message, command: [], prompt: "", dryRun: false };
}

function isTerminal(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "timed_out";
}

function removeQueuedId(queue: string[], jobId: string): void {
  const index = queue.indexOf(jobId);
  if (index >= 0) queue.splice(index, 1);
}
