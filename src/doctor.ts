import { spawnSync } from "node:child_process";
import { defaultConfig } from "./config.js";
import { checkHermesStatus, versionProbeTimeoutMs } from "./status.js";
import { buildEffectiveRun } from "./run.js";
import { runHermesCli } from "./adapters/hermes-cli.js";
import { skillStates } from "./install/install-service.js";
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

/** Synchronous environment checks. The optional `--probe` check is added separately by the caller. */
export function coreChecks(config: BridgeConfig | null, ctx: PathContext, configError?: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [nodeCheck(), configCheck(config, configError), hermesCheck(config ?? defaultConfig)];
  for (const agent of Object.keys(agentCommand) as SkillAgent[]) {
    checks.push(agentAvailabilityCheck(agent));
  }
  for (const { agent, state } of skillStates(ctx, "global")) {
    checks.push(skillCheck(agent, state));
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

function agentAvailabilityCheck(agent: SkillAgent): DoctorCheck {
  const command = agentCommand[agent];
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: versionProbeTimeoutMs });
  if (result.error) return { id: agent, status: "warn", detail: `${command} not found on PATH` };
  if (result.status !== 0) return { id: agent, status: "warn", detail: `${command} --version exited with ${result.status ?? `signal ${result.signal}`}` };
  return { id: agent, status: "pass", detail: result.stdout.trim() || result.stderr.trim() };
}

const skillStateDetail: Record<ManagedState, string> = {
  current: "up to date",
  absent: "not installed",
  stale: "out of date (run: install --force)",
  "user-modified": "modified locally",
  foreign: "a non-managed file is present",
};

function skillCheck(agent: SkillAgent, state: ManagedState): DoctorCheck {
  return { id: `skill:${agent}`, status: state === "current" ? "pass" : "warn", detail: skillStateDetail[state] };
}
