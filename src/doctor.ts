import { spawnSync } from "node:child_process";
import { defaultConfig } from "./config.js";
import { listBridgeTools } from "./mcp-catalog.js";
import { checkHermesStatus, versionProbeTimeoutMs } from "./status.js";
import { buildEffectiveRun, defaultTimeoutSeconds } from "./run.js";
import { runHermesCli } from "./adapters/hermes-cli.js";
import { skillStates } from "./install/install-service.js";
import { inspectMcp, type McpCommandRunner, type McpLauncher, type McpRegistration } from "./install/mcp-service.js";
import type { BridgeConfig } from "./types.js";
import type { ManagedState, PathContext, SkillAgent } from "./install/types.js";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  detail?: string | undefined;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

const minNodeMajor = 20;
const agentCommand: Record<SkillAgent, string> = { "claude-code": "claude", codex: "codex" };

export interface DoctorOptions {
  launcher?: McpLauncher | undefined;
  commandRunner?: McpCommandRunner | undefined;
}

/** Synchronous environment checks. The optional `--probe` check is added separately by the caller. */
export function coreChecks(config: BridgeConfig | null, ctx: PathContext, configError?: string, options: DoctorOptions = {}): DoctorCheck[] {
  const checks: DoctorCheck[] = [nodeCheck(), configCheck(config, configError), hermesCheck(config ?? defaultConfig), limitsCheck(config ?? defaultConfig)];
  const skills = new Map(skillStates(ctx, "global").map(({ agent, state }) => [agent, state]));
  for (const agent of Object.keys(agentCommand) as SkillAgent[]) {
    const availability = agentAvailabilityCheck(agent, options.commandRunner);
    const skillState = skills.get(agent) ?? "absent";
    const registration = options.launcher
      ? inspectMcp(agent, options.launcher, options.commandRunner)
      : undefined;
    checks.push(availability.check);
    checks.push(skillCheck(agent, skillState, availability.available, registration));
    if (registration) checks.push(mcpCheck(registration, skillState));
  }
  return checks;
}

export function toReport(checks: DoctorCheck[]): DoctorReport {
  return { ok: !checks.some((check) => check.status === "fail"), checks };
}

/** Optional live check (spends provider tokens): ask Hermes to echo a sentinel through the full pipeline. */
export async function probeCheck(config: BridgeConfig): Promise<DoctorCheck> {
  const run = buildEffectiveRun(config, {
    prompt: "Return the word BRIDGE_OK only. Do not use tools.",
    mode: "plan",
    contextFiles: [],
    yolo: false,
    dryRun: false,
    json: false,
  });
  const result = await runHermesCli(config, run, false);
  const ok = result.ok && `${result.stdout}${result.stderr}`.includes("BRIDGE_OK");
  return { id: "probe", status: ok ? "pass" : "warn", detail: ok ? "Hermes responded" : `exit ${result.exitCode}` };
}

/** Token-free MCP initialize/list-tools handshake against the current server implementation. */
export async function mcpHandshakeCheck(config: BridgeConfig): Promise<DoctorCheck> {
  try {
    const tools = await listBridgeTools(config);
    const names = new Set(tools.map((tool) => tool.name));
    const required = ["hermes_run", "hermes_plan", "hermes_capabilities", "hermes_status"];
    const missing = required.filter((name) => !names.has(name));
    return missing.length === 0
      ? { id: "mcp:handshake", status: "pass", detail: `${tools.length} tools available` }
      : { id: "mcp:handshake", status: "fail", detail: `missing tools: ${missing.join(", ")}` };
  } catch (error) {
    return { id: "mcp:handshake", status: "fail", detail: error instanceof Error ? error.message : String(error) };
  }
}

export function formatDoctor(report: DoctorReport): string {
  const label: Record<CheckStatus, string> = { pass: "ok", warn: "warn", fail: "FAIL" };
  const lines = report.checks.map((check) => `[${label[check.status]}] ${check.id}${check.detail ? `: ${check.detail}` : ""}`);
  lines.push(report.ok ? "All required checks passed." : "Some required checks failed.");
  return lines.join("\n");
}

function nodeCheck(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  return { id: "node", status: major >= minNodeMajor ? "pass" : "fail", detail: `v${process.versions.node}` };
}

function configCheck(config: BridgeConfig | null, configError?: string): DoctorCheck {
  if (config) return { id: "config", status: "pass", detail: "loaded" };
  return { id: "config", status: "fail", detail: configError ?? "could not load configuration" };
}

function hermesCheck(config: BridgeConfig): DoctorCheck {
  const status = checkHermesStatus(config);
  if (status.available) return { id: "hermes", status: "pass", detail: status.version };
  return { id: "hermes", status: "fail", detail: status.error };
}

/** Surfaces the effective runtime limits so users can see why a large run is rejected or timed out. */
function limitsCheck(config: BridgeConfig): DoctorCheck {
  const timeout = config.runtime.timeoutSeconds
    ? `${config.runtime.timeoutSeconds}s (configured)`
    : `${defaultTimeoutSeconds("plan")}s plan / ${defaultTimeoutSeconds("execute")}s execute`;
  return { id: "limits", status: "pass", detail: `context ≤ ${config.runtime.maxContextBytes} bytes, timeout ${timeout}` };
}

function agentAvailabilityCheck(agent: SkillAgent, runner?: McpCommandRunner): { check: DoctorCheck; available: boolean } {
  const command = agentCommand[agent];
  const result = runner
    ? runner(command, ["--version"])
    : (() => {
        const process = spawnSync(command, ["--version"], { encoding: "utf8", timeout: versionProbeTimeoutMs });
        const error = process.error
          ? { code: (process.error as NodeJS.ErrnoException).code, message: process.error.message }
          : undefined;
        return { status: process.status, stdout: process.stdout ?? "", stderr: process.stderr ?? "", ...(error ? { error } : {}) };
      })();
  if (result.error) return { check: { id: agent, status: "warn", detail: `${command} not found on PATH` }, available: false };
  if (result.status !== 0) {
    return { check: { id: agent, status: "warn", detail: `${command} --version exited with ${result.status ?? "unknown status"}` }, available: false };
  }
  return { check: { id: agent, status: "pass", detail: result.stdout.trim() || result.stderr.trim() }, available: true };
}

const skillStateDetail: Record<ManagedState, string> = {
  current: "up to date",
  absent: "not installed",
  stale: "out of date (run: install --force)",
  "user-modified": "modified locally",
  foreign: "a non-managed file is present",
};

function skillCheck(agent: SkillAgent, state: ManagedState, agentAvailable: boolean, registration?: McpRegistration): DoctorCheck {
  const unusedTarget = state === "absent" && !agentAvailable && (!registration || registration.state === "unavailable");
  return {
    id: `skill:${agent}`,
    status: state === "current" ? "pass" : unusedTarget ? "warn" : "fail",
    detail: skillStateDetail[state],
  };
}

function mcpCheck(registration: McpRegistration, skillState: ManagedState): DoctorCheck {
  const unusedTarget = registration.state === "unavailable" && skillState === "absent";
  const detail: Record<McpRegistration["state"], string> = {
    absent: "not registered (run: hermes-action install all)",
    current: "registered with the current bridge launcher",
    conflict: registration.detail ?? "a different hermes-action registration is present",
    unavailable: registration.detail ?? "agent CLI is unavailable",
    error: registration.detail ?? "registration could not be inspected",
  };
  return {
    id: `mcp:${registration.agent}`,
    status: registration.state === "current" ? "pass" : unusedTarget ? "warn" : "fail",
    detail: detail[registration.state],
  };
}
