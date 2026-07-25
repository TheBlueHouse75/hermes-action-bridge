import { describe, expect, it } from "vitest";
import { createJobStore, type StartExecution } from "../src/jobs.js";
import type { AdapterResult, EffectiveRun } from "../src/types.js";

function effectiveRun(): EffectiveRun {
  return {
    mode: "plan", requestedMode: "plan", presetName: "default", preset: { skills: [], toolsets: [] },
    prompt: "private handoff", source: "test", maxTurns: 1, yolo: false, detectedRisks: [], contextDocuments: [], timeoutSeconds: 1,
  };
}

function result(overrides: Partial<AdapterResult> = {}): AdapterResult {
  return { ok: true, exitCode: 0, stdout: "done", stderr: "", command: [], prompt: "private handoff", dryRun: false, ...overrides };
}

describe("job store", () => {
  it("stores bounded results without retaining the prompt in its public record", async () => {
    let resolve!: (value: AdapterResult) => void;
    const starter: StartExecution = () => ({ result: new Promise<AdapterResult>((done) => { resolve = done; }), cancel: () => true });
    const store = createJobStore(starter, { maxOutputBytes: 4, createId: () => "job-1" });
    const job = store.submit(effectiveRun());
    expect(JSON.stringify(job)).not.toContain("private handoff");
    resolve(result({ stdout: "abcdef" }));
    await Promise.resolve();
    expect(store.get("job-1")).toMatchObject({ status: "succeeded", output: { stdout: "abcd", stderr: "", truncated: true } });
  });

  it("cancels once and reports cancelled when the child settles", async () => {
    let resolve!: (value: AdapterResult) => void;
    let cancelCalls = 0;
    const starter: StartExecution = () => ({ result: new Promise<AdapterResult>((done) => { resolve = done; }), cancel: () => ++cancelCalls === 1 });
    const store = createJobStore(starter, { createId: () => "job-2" });
    store.submit(effectiveRun());
    expect(store.cancel("job-2")?.status).toBe("running");
    expect(store.cancel("job-2")?.status).toBe("running");
    expect(cancelCalls).toBe(1);
    resolve(result({ ok: false, exitCode: 143 }));
    await Promise.resolve();
    expect(store.get("job-2")?.status).toBe("cancelled");
  });

  it("caps aggregate output at a UTF-8 boundary", async () => {
    const starter: StartExecution = () => ({ result: Promise.resolve(result({ stdout: "€€", stderr: "x" })), cancel: () => false });
    const store = createJobStore(starter, { maxOutputBytes: 4, createId: () => "job-utf8" });
    store.submit(effectiveRun());
    await Promise.resolve();
    const output = store.get("job-utf8")?.output;
    expect(output).toEqual({ stdout: "€", stderr: "x", truncated: true });
    expect(Buffer.byteLength(`${output?.stdout}${output?.stderr}`, "utf8")).toBeLessThanOrEqual(4);
  });

  it("runs the pre-start hook before starting the Hermes process", () => {
    let started = false;
    const store = createJobStore(() => {
      started = true;
      return { result: Promise.resolve(result()), cancel: () => false };
    }, { createId: () => "job-audit" });
    const job = store.submit(effectiveRun(), {
      beforeStart: () => {
        throw new Error("audit unavailable");
      },
    });

    expect(started).toBe(false);
    expect(job).toMatchObject({
      status: "failed",
      output: { stderr: "audit unavailable" },
    });
  });

  it("removes only expired terminal jobs", async () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const starter: StartExecution = () => ({ result: Promise.resolve(result()), cancel: () => false });
    const store = createJobStore(starter, { ttlMs: 10, now: () => clock, createId: () => "job-3" });
    store.submit(effectiveRun());
    await Promise.resolve();
    clock = new Date("2026-01-01T00:00:00.010Z");
    expect(store.cleanup()).toBe(1);
    expect(store.get("job-3")).toBeUndefined();
  });

  it("queues work above the concurrency limit and starts it after settlement", async () => {
    const resolvers: Array<(value: AdapterResult) => void> = [];
    const starter: StartExecution = () => ({
      result: new Promise<AdapterResult>((resolve) => resolvers.push(resolve)),
      cancel: () => true,
    });
    let nextId = 0;
    const store = createJobStore(starter, {
      maxConcurrent: 1,
      createId: () => `job-queue-${++nextId}`,
    });

    expect(store.submit(effectiveRun()).status).toBe("running");
    expect(store.submit(effectiveRun()).status).toBe("queued");
    expect(resolvers).toHaveLength(1);
    resolvers[0]?.(result());
    await Promise.resolve();
    expect(store.get("job-queue-2")?.status).toBe("running");
    expect(resolvers).toHaveLength(2);
    resolvers[1]?.(result());
    await Promise.resolve();
  });

  it("expires queued work without orphaning a running process", () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    const starter: StartExecution = () => ({ result: new Promise<AdapterResult>(() => undefined), cancel: () => true });
    let nextId = 0;
    const store = createJobStore(starter, {
      ttlMs: 10,
      maxConcurrent: 1,
      now: () => clock,
      createId: () => `job-expiry-${++nextId}`,
    });
    store.submit(effectiveRun());
    store.submit(effectiveRun());

    clock = new Date("2026-01-01T00:00:00.010Z");
    expect(store.cleanup()).toBe(1);
    expect(store.get("job-expiry-1")?.status).toBe("running");
    expect(store.get("job-expiry-2")).toBeUndefined();
  });

  it("rejects submissions above the bounded queue capacity", () => {
    const starter: StartExecution = () => ({ result: new Promise<AdapterResult>(() => undefined), cancel: () => true });
    let nextId = 0;
    const store = createJobStore(starter, {
      maxConcurrent: 1,
      maxQueued: 1,
      createId: () => `job-cap-${++nextId}`,
    });
    store.submit(effectiveRun());
    store.submit(effectiveRun());

    expect(store.canSubmit()).toBe(false);
    expect(() => store.submit(effectiveRun())).toThrow("queue is full");
  });

  it("never starts queued work after its approval deadline", async () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    let resolveRunning!: (value: AdapterResult) => void;
    let starts = 0;
    let nextId = 0;
    const store = createJobStore(() => {
      starts += 1;
      return starts === 1
        ? { result: new Promise<AdapterResult>((resolve) => { resolveRunning = resolve; }), cancel: () => true }
        : { result: Promise.resolve(result()), cancel: () => true };
    }, {
      maxConcurrent: 1,
      now: () => clock,
      createId: () => `job-deadline-${++nextId}`,
    });
    store.submit(effectiveRun());
    store.submit(effectiveRun(), { startBefore: "2026-01-01T00:00:00.010Z" });

    clock = new Date("2026-01-01T00:00:00.010Z");
    resolveRunning(result());
    await Promise.resolve();
    expect(starts).toBe(1);
    expect(store.get("job-deadline-2")?.status).toBe("timed_out");
  });

  it("retains a completed result after its start deadline until the job TTL", async () => {
    let clock = new Date("2026-01-01T00:00:00.000Z");
    let resolveRunning!: (value: AdapterResult) => void;
    const store = createJobStore(() => ({
      result: new Promise<AdapterResult>((resolve) => { resolveRunning = resolve; }),
      cancel: () => true,
    }), {
      now: () => clock,
      createId: () => "job-retention",
    });
    store.submit(effectiveRun(), { startBefore: "2026-01-01T00:00:00.010Z" });
    clock = new Date("2026-01-01T00:00:00.020Z");
    resolveRunning(result());
    await Promise.resolve();

    expect(store.get("job-retention")).toMatchObject({
      status: "succeeded",
      output: { stdout: "done" },
    });
  });

  it("cancels queued and running work during shutdown", async () => {
    let resolveRunning!: (value: AdapterResult) => void;
    let cancelCalls = 0;
    let nextId = 0;
    const store = createJobStore(() => ({
      result: new Promise<AdapterResult>((resolve) => {
        resolveRunning = resolve;
      }),
      cancel: () => {
        cancelCalls += 1;
        return true;
      },
    }), {
      maxConcurrent: 1,
      createId: () => `job-shutdown-${++nextId}`,
    });
    store.submit(effectiveRun());
    store.submit(effectiveRun());

    const shutdown = store.shutdown();
    expect(cancelCalls).toBe(1);
    expect(store.get("job-shutdown-2")?.status).toBe("cancelled");
    expect(() => store.submit(effectiveRun())).toThrow("shutting down");
    resolveRunning(result({ ok: false, exitCode: 143 }));
    await shutdown;
    expect(store.get("job-shutdown-1")?.status).toBe("cancelled");
  });
});
