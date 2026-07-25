import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendAuditEvent, fingerprintPrompt, type AuditEvent } from "./audit-log.js";
import { createApprovalStore, type ApprovalStore } from "./approvals.js";
import { startHermesCli } from "./adapters/hermes-cli.js";
import { getBridgeCapabilities } from "./capabilities.js";
import { loadConfig } from "./config.js";
import { createExecutionGate, type ExecutionGate } from "./execution-gate.js";
import { createJobStore, defaultJobMaxOutputBytes, type BridgeJob, type JobStore } from "./jobs.js";
import { buildEffectiveRun } from "./run.js";
import { checkHermesStatus } from "./status.js";
import { version } from "./version.js";
import type { BridgeConfig, BridgeMode, EffectiveRun } from "./types.js";

const modeSchema = z.enum(["plan", "draft", "execute", "request-approval"]);
const idSchema = z.string().uuid();
const serverInstructions = [
  "Use Hermes for capabilities owned by the Hermes runtime: configured skills, connected services, messaging, schedules, browser workflows, and persistent external automation.",
  "Call hermes_capabilities before assuming that a Hermes preset, skill, or toolset is configured.",
  "Prefer hermes_plan or hermes_prepare before an action with external side effects.",
  "Do not delegate ordinary local code edits or repository inspection when the host agent can perform them directly.",
].join(" ");

type BridgeToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type BridgeTransport = "stdio" | "http";

interface RequestAuditContext {
  principalId: string;
  transport: BridgeTransport;
  promptFingerprint: string;
  requestedMode: BridgeMode;
  effectiveMode: BridgeMode;
  presetName: string;
  detectedRisks: EffectiveRun["detectedRisks"];
}

export interface BridgeRuntime {
  jobs: JobStore;
  approvals: ApprovalStore;
  auditFile: string;
  jobAudit: Map<string, RequestAuditContext>;
  approvalAudit: Map<string, RequestAuditContext>;
  directExecutions: ExecutionGate;
  dispose(): Promise<void>;
}

export interface BridgeServerOptions {
  transport?: BridgeTransport | undefined;
  principalId?: string | undefined;
  runtime?: BridgeRuntime | undefined;
}

/**
 * Single error boundary for every tool handler: bad presets, missing context,
 * process errors, storage errors, and serialization become structured MCP
 * errors instead of terminating the server.
 */
async function guard(produce: () => BridgeToolResult | Promise<BridgeToolResult>): Promise<BridgeToolResult> {
  try {
    return await produce();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Bridge error: ${message}` }], isError: true };
  }
}

interface DelegateOptions {
  prompt: string;
  mode?: BridgeMode | undefined;
  preset?: string | undefined;
  contextFiles?: string[] | undefined;
  yolo?: boolean | undefined;
  dryRun?: boolean | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  maxTurns?: number | undefined;
  timeoutSeconds?: number | undefined;
}

function effectiveRun(config: BridgeConfig, options: DelegateOptions): EffectiveRun {
  return buildEffectiveRun(config, {
    prompt: options.prompt,
    mode: options.mode,
    preset: options.preset,
    contextFiles: options.contextFiles ?? [],
    yolo: options.yolo ?? false,
    dryRun: options.dryRun ?? false,
    json: false,
    provider: options.provider,
    model: options.model,
    maxTurns: options.maxTurns,
    timeoutSeconds: options.timeoutSeconds,
  });
}

async function delegate(config: BridgeConfig, options: DelegateOptions): Promise<BridgeToolResult> {
  const dryRun = options.dryRun ?? false;
  const run = effectiveRun(config, options);
  const result = await startHermesCli(config, run, dryRun, { maxOutputBytes: defaultJobMaxOutputBytes }).result;
  const sections = [result.stdout, result.stderr].filter((section) => section.trim().length > 0);
  if (result.outputTruncated) sections.push(`[Hermes output truncated at ${defaultJobMaxOutputBytes} bytes]`);
  const text = sections.length > 0 ? sections.join("\n") : `Hermes exited with code ${result.exitCode}`;
  const content = [{ type: "text" as const, text }];
  return result.ok ? { content } : { content, isError: true };
}

function jsonResult(value: unknown): BridgeToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function defaultAuditFile(): string {
  if (process.env.HERMES_ACTION_AUDIT_FILE) return process.env.HERMES_ACTION_AUDIT_FILE;
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateHome, "hermes-action", "audit.jsonl");
}

function auditContext(run: EffectiveRun, transport: BridgeTransport, principalId: string): RequestAuditContext {
  return {
    principalId,
    transport,
    promptFingerprint: fingerprintPrompt(run.prompt),
    requestedMode: run.requestedMode,
    effectiveMode: run.mode,
    presetName: run.presetName,
    detectedRisks: [...run.detectedRisks],
  };
}

function auditEvent(
  phase: AuditEvent["phase"],
  requestId: string,
  context: RequestAuditContext,
  terminal?: { exitCode?: number | undefined; outcome?: AuditEvent["outcome"] | undefined },
): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    phase,
    requestId,
    principalId: context.principalId,
    transport: context.transport,
    requestedMode: context.requestedMode,
    effectiveMode: context.effectiveMode,
    presetName: context.presetName,
    detectedRisks: [...context.detectedRisks],
    promptFingerprint: context.promptFingerprint,
    ...(terminal?.exitCode === undefined ? {} : { exitCode: terminal.exitCode }),
    ...(terminal?.outcome === undefined ? {} : { outcome: terminal.outcome }),
  };
}

function terminalOutcome(job: BridgeJob): AuditEvent["outcome"] {
  switch (job.status) {
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    default:
      return "failed";
  }
}

export function createBridgeRuntime(config: BridgeConfig, auditFile = defaultAuditFile()): BridgeRuntime {
  const jobAudit = new Map<string, RequestAuditContext>();
  const approvalAudit = new Map<string, RequestAuditContext>();
  const jobs = createJobStore((run) => startHermesCli(config, run, false, { maxOutputBytes: defaultJobMaxOutputBytes }), {
    onSettled: (job) => {
      const context = jobAudit.get(job.id);
      if (!context) return;
      if (job.status === "timed_out" && !job.startedAt) {
        appendAuditEvent(auditFile, auditEvent("expired", job.id, context));
        return;
      }
      appendAuditEvent(auditFile, auditEvent(job.status === "cancelled" ? "cancelled" : "completed", job.id, context, {
        exitCode: job.exitCode,
        outcome: terminalOutcome(job),
      }));
    },
  });
  const approvals = createApprovalStore({
    onExpired: (approval) => {
      const context = approvalAudit.get(approval.id);
      if (context) appendAuditEvent(auditFile, auditEvent("expired", approval.id, context));
    },
  });
  const cleanupTimer = setInterval(() => {
    jobs.cleanup();
    approvals.cleanup();
    pruneAuditContexts(jobAudit, (id) => jobs.get(id) !== undefined);
    pruneAuditContexts(approvalAudit, (id) => approvals.get(id) !== undefined);
  }, 60_000);
  cleanupTimer.unref();
  return {
    jobs,
    approvals,
    auditFile,
    jobAudit,
    approvalAudit,
    directExecutions: createExecutionGate(),
    dispose: async () => {
      clearInterval(cleanupTimer);
      await jobs.shutdown();
    },
  };
}

export function createBridgeMcpServer(config: BridgeConfig, options: BridgeServerOptions = {}): McpServer {
  const transport = options.transport ?? "stdio";
  const principalId = options.principalId ?? transport;
  const runtime = options.runtime ?? createBridgeRuntime(config);
  const server = new McpServer(
    { name: "hermes-action-bridge", version },
    { instructions: serverInstructions },
  );

  server.registerTool(
    "hermes_run",
    {
      title: "Delegate a request to Hermes",
      description:
        "Use Hermes-owned skills, connected services, browser workflows, messaging, schedules, or external automation through bridge policy. Do not use for ordinary local code edits.",
      inputSchema: {
        prompt: z.string().min(1),
        mode: modeSchema.optional(),
        preset: z.string().optional(),
        contextFiles: z.array(z.string()).optional(),
        yolo: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        maxTurns: z.number().int().positive().optional(),
        timeoutSeconds: z.number().int().positive().optional(),
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      guard(() =>
        runtime.directExecutions.run(() => delegate(config, {
          prompt: args.prompt,
          mode: args.mode as BridgeMode | undefined,
          preset: args.preset,
          contextFiles: args.contextFiles,
          yolo: args.yolo,
          dryRun: args.dryRun,
          provider: args.provider,
          model: args.model,
          maxTurns: args.maxTurns,
          timeoutSeconds: args.timeoutSeconds,
        })),
      ),
  );

  server.registerTool(
    "hermes_plan",
    {
      title: "Ask Hermes for a plan",
      description:
        "Ask Hermes to inspect its configured capabilities in plan mode. Hermes may access open-world tools, so review the response before taking or approving an external action.",
      inputSchema: {
        prompt: z.string().min(1),
        preset: z.string().optional(),
        contextFiles: z.array(z.string()).optional(),
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      guard(() => runtime.directExecutions.run(() => delegate(config, {
        prompt: args.prompt,
        mode: "plan",
        preset: args.preset,
        contextFiles: args.contextFiles,
      }))),
  );

  server.registerTool(
    "hermes_capabilities",
    {
      title: "Discover configured Hermes capabilities",
      description:
        "Inspect bridge status, configured presets, skills, toolsets, providers, models, and policy before deciding whether Hermes owns the requested capability.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => guard(() => jsonResult(getBridgeCapabilities(config, transport))),
  );

  server.registerTool(
    "hermes_presets",
    {
      title: "List Hermes delegation presets",
      description: "List configured bridge presets and their declarative Hermes skills and toolsets.",
      annotations: { readOnlyHint: true },
    },
    () => guard(() => jsonResult(config.presets)),
  );

  server.registerTool(
    "hermes_status",
    {
      title: "Check Hermes runtime status",
      description: "Check whether the configured Hermes CLI runtime is available without running a provider request.",
      annotations: { readOnlyHint: true },
    },
    () => guard(() => jsonResult(checkHermesStatus(config))),
  );

  server.registerTool(
    "hermes_submit",
    {
      title: "Submit a cancellable Hermes job",
      description:
        "Start a long Hermes plan, draft, or approval-preview job and return immediately. Direct execute requests are converted to request-approval; use hermes_prepare and hermes_approve for execution.",
      inputSchema: {
        prompt: z.string().min(1),
        mode: modeSchema.optional(),
        preset: z.string().optional(),
        contextFiles: z.array(z.string()).optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        maxTurns: z.number().int().positive().optional(),
        timeoutSeconds: z.number().int().positive().optional(),
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      guard(() => {
        const built = effectiveRun(config, {
          prompt: args.prompt,
          mode: args.mode as BridgeMode | undefined,
          preset: args.preset,
          contextFiles: args.contextFiles,
          provider: args.provider,
          model: args.model,
          maxTurns: args.maxTurns,
          timeoutSeconds: args.timeoutSeconds,
        });
        const run: EffectiveRun = {
          ...built,
          mode: built.mode === "execute" ? "request-approval" : built.mode,
          yolo: false,
        };
        const context = auditContext(run, transport, principalId);
        return jsonResult(submitAuditedJob(runtime, run, context));
      }),
  );

  server.registerTool(
    "hermes_job_status",
    {
      title: "Check a Hermes job",
      description: "Read lifecycle metadata for an asynchronous Hermes job without returning its output.",
      inputSchema: { jobId: idSchema },
      annotations: { readOnlyHint: true },
    },
    ({ jobId }) =>
      guard(() => {
        ensureJobOwner(runtime, jobId, principalId);
        const job = runtime.jobs.get(jobId);
        if (!job) throw new Error(`Unknown job: ${jobId}`);
        const { output: _output, ...status } = job;
        return jsonResult(status);
      }),
  );

  server.registerTool(
    "hermes_result",
    {
      title: "Read a Hermes job result",
      description: "Read the bounded stdout/stderr result of a completed asynchronous Hermes job.",
      inputSchema: { jobId: idSchema },
      annotations: { readOnlyHint: true },
    },
    ({ jobId }) =>
      guard(() => {
        ensureJobOwner(runtime, jobId, principalId);
        const job = runtime.jobs.get(jobId);
        if (!job) throw new Error(`Unknown job: ${jobId}`);
        return jsonResult(job);
      }),
  );

  server.registerTool(
    "hermes_cancel",
    {
      title: "Cancel a Hermes job",
      description: "Idempotently cancel a queued or running asynchronous Hermes job.",
      inputSchema: { jobId: idSchema },
    },
    ({ jobId }) =>
      guard(() => {
        ensureJobOwner(runtime, jobId, principalId);
        const job = runtime.jobs.cancel(jobId);
        if (!job) throw new Error(`Unknown job: ${jobId}`);
        return jsonResult(job);
      }),
  );

  server.registerTool(
    "hermes_prepare",
    {
      title: "Prepare an external action for approval",
      description:
        "Create a local, non-executing preview and short-lived one-shot approval ID without invoking Hermes or its tools. The caller must show preview.action to the human before approval.",
      inputSchema: {
        prompt: z.string().min(1),
        preset: z.string().optional(),
        contextFiles: z.array(z.string()).optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
        maxTurns: z.number().int().positive().optional(),
        timeoutSeconds: z.number().int().positive().optional(),
      },
      annotations: { openWorldHint: true },
    },
    (args) =>
      guard(() => {
        const built = effectiveRun(config, {
          prompt: args.prompt,
          mode: "execute",
          preset: args.preset,
          contextFiles: args.contextFiles,
          provider: args.provider,
          model: args.model,
          maxTurns: args.maxTurns,
          timeoutSeconds: args.timeoutSeconds,
        });
        const run: EffectiveRun = { ...built, mode: "request-approval", yolo: false };
        const approval = runtime.approvals.prepare(run);
        const context = auditContext(run, transport, principalId);
        runtime.approvalAudit.set(approval.id, context);
        try {
          appendAuditEvent(runtime.auditFile, auditEvent("prepared", approval.id, context));
        } catch (error) {
          runtime.approvals.reject(approval.id);
          runtime.approvalAudit.delete(approval.id);
          throw error;
        }
        return jsonResult({
          ...approval,
          preview: {
            action: run.prompt,
            presetName: run.presetName,
            requestedMode: run.requestedMode,
            effectiveMode: run.mode,
            detectedRisks: run.detectedRisks,
            contextFiles: run.contextDocuments.map((document) => document.path),
            promptFingerprint: context.promptFingerprint,
          },
        });
      }),
  );

  server.registerTool(
    "hermes_approve",
    {
      title: "Approve and submit a prepared Hermes action",
      description:
        "Consume a prepared approval ID exactly once and submit the unchanged request for execution. This can cause external side effects.",
      inputSchema: { approvalId: idSchema },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    ({ approvalId }) =>
      guard(() => {
        const context = ensureApprovalOwner(runtime, approvalId, principalId);
        const current = runtime.approvals.get(approvalId);
        if (!current || current.status !== "awaiting_approval") {
          throw new Error(`Approval is unavailable, expired, or already consumed: ${approvalId}`);
        }
        if (!runtime.jobs.canSubmit()) throw new Error("Hermes job queue is full; approval was not consumed");
        appendAuditEvent(runtime.auditFile, auditEvent("approved", approvalId, context));
        const consumed = runtime.approvals.approve(approvalId);
        if (!consumed) throw new Error(`Approval is unavailable, expired, or already consumed: ${approvalId}`);
        const run: EffectiveRun = { ...consumed.run, mode: "execute", requestedMode: "execute" };
        const jobContext = { ...context, effectiveMode: "execute" as const };
        const job = submitAuditedJob(runtime, run, jobContext, consumed.approval.expiresAt);
        runtime.approvalAudit.delete(approvalId);
        return jsonResult({ approval: consumed.approval, job });
      }),
  );

  server.registerTool(
    "hermes_reject",
    {
      title: "Reject a prepared Hermes action",
      description: "Consume a prepared approval ID without executing the external action.",
      inputSchema: { approvalId: idSchema },
    },
    ({ approvalId }) =>
      guard(() => {
        const context = ensureApprovalOwner(runtime, approvalId, principalId);
        const current = runtime.approvals.get(approvalId);
        if (!current || current.status !== "awaiting_approval") {
          throw new Error(`Approval is unavailable, expired, or already consumed: ${approvalId}`);
        }
        appendAuditEvent(runtime.auditFile, auditEvent("rejected", approvalId, context));
        const rejected = runtime.approvals.reject(approvalId);
        if (!rejected) throw new Error(`Unknown approval: ${approvalId}`);
        runtime.approvalAudit.delete(approvalId);
        return jsonResult(rejected);
      }),
  );

  return server;
}

function ensureJobOwner(runtime: BridgeRuntime, jobId: string, principalId: string): void {
  const owner = runtime.jobAudit.get(jobId);
  if (!owner) throw new Error(`Unknown job: ${jobId}`);
  if (owner.principalId !== principalId) throw new Error(`Job is not available to this principal: ${jobId}`);
}

function submitAuditedJob(
  runtime: BridgeRuntime,
  run: EffectiveRun,
  context: RequestAuditContext,
  startBefore?: string,
): BridgeJob {
  const job = runtime.jobs.submit(run, {
    beforeStart: (queuedJob) => {
      runtime.jobAudit.set(queuedJob.id, context);
      appendAuditEvent(runtime.auditFile, auditEvent("submitted", queuedJob.id, context));
    },
    startBefore,
  });
  runtime.jobAudit.set(job.id, context);
  return job;
}

function ensureApprovalOwner(runtime: BridgeRuntime, approvalId: string, principalId: string): RequestAuditContext {
  const owner = runtime.approvalAudit.get(approvalId);
  if (!owner) throw new Error(`Unknown approval: ${approvalId}`);
  if (owner.principalId !== principalId) throw new Error(`Approval is not available to this principal: ${approvalId}`);
  return owner;
}

function pruneAuditContexts(contexts: Map<string, RequestAuditContext>, exists: (id: string) => boolean): void {
  for (const id of contexts.keys()) {
    if (!exists(id)) contexts.delete(id);
  }
}

export async function startMcpServer(configPath?: string): Promise<void> {
  const config = loadConfig(process.cwd(), configPath);
  const runtime = createBridgeRuntime(config);
  const server = createBridgeMcpServer(config, { runtime });
  const transport = new StdioServerTransport();
  let disposePromise: Promise<void> | undefined;
  const disposeRuntime = (): Promise<void> => {
    disposePromise ??= runtime.dispose();
    return disposePromise;
  };
  const removeSignalHandlers = (): void => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const shutdown = async (): Promise<void> => {
    await disposeRuntime();
    await server.close().catch(() => undefined);
    removeSignalHandlers();
  };
  const onSignal = (): void => {
    void shutdown().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  };
  transport.onclose = () => {
    void disposeRuntime().finally(removeSignalHandlers);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await server.connect(transport);
  } catch (error) {
    removeSignalHandlers();
    await disposeRuntime();
    throw error;
  }
}
