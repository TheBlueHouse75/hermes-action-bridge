import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { versionProbeTimeoutMs } from "../status.js";
import type { FileChange, McpTarget, SkillAgent } from "./types.js";

const mcpServerName = "hermes-action";
const allAgents: SkillAgent[] = ["codex", "claude-code"];

interface CommandError {
  code?: string | undefined;
  message: string;
}

export interface McpCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: CommandError | undefined;
}

/** Injectable process boundary: tests never invoke the real Codex or Claude binaries. */
export type McpCommandRunner = (command: string, args: string[]) => McpCommandResult;

export interface McpLauncher {
  command: string;
  args: string[];
}

export interface McpServiceOptions {
  launcher: McpLauncher;
  dryRun: boolean;
  runner?: McpCommandRunner | undefined;
}

export interface McpTargetResult {
  agent: SkillAgent;
  ok: boolean;
  dryRun: boolean;
  change: FileChange;
}

export type McpRegistrationState = "absent" | "current" | "conflict" | "unavailable" | "error";

export interface McpRegistration {
  agent: SkillAgent;
  state: McpRegistrationState;
  detail?: string | undefined;
}

/**
 * Register the stdio bridge via each agent's supported CLI instead of editing
 * implementation-owned TOML/JSON. This preserves unrelated user servers.
 */
export function installMcp(target: McpTarget, options: McpServiceOptions): McpTargetResult[] {
  const agents = agentsFor(target);
  const runner = options.runner ?? systemRunner;
  const planned = agents.map((agent) => planInstall(agent, options, runner));
  if (options.dryRun || planned.some((entry) => !entry.ok)) return planned;

  const applied: McpTargetResult[] = [];
  for (const plan of planned) {
    if (plan.change.action === "unchanged") {
      applied.push(plan);
      continue;
    }
    const installed = installOne(plan.agent, options);
    applied.push(installed);
    if (installed.ok) continue;
    const failure = installed.change.reason ?? "registration failed";
    return [
      ...rollbackCreated(applied, options, runner, failure),
      ...planned.slice(applied.length).map((entry) =>
        result(entry.agent, "refused", false, `registration not attempted because another agent failed: ${failure}`),
      ),
    ];
  }
  return applied;
}

/** Remove only the named bridge registration through the owning agent CLI. */
export function uninstallMcp(target: McpTarget, options: McpServiceOptions): McpTargetResult[] {
  return forAgents(target, (agent) => uninstallOne(agent, options));
}

/** Public inspection used by doctor and setup reporting. It never mutates agent configuration. */
export function inspectMcp(agent: SkillAgent, launcher: McpLauncher, runner: McpCommandRunner = systemRunner): McpRegistration {
  if (!isAbsolute(launcher.command)) return { agent, state: "error", detail: "bridge launcher command must be absolute" };
  const result = runner(agentCommand(agent), getArgs(agent));
  if (result.error?.code === "ENOENT") return { agent, state: "unavailable", detail: `${agentCommand(agent)} is not available on PATH` };
  if (result.error) return { agent, state: "error", detail: result.error.message };
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0) {
    return isMissingServerOutput(output)
      ? { agent, state: "absent" }
      : { agent, state: "error", detail: commandFailure(agentCommand(agent), "inspect", result) };
  }
  const fields = registrationFields(output);
  const expectedScope = agent !== "claude-code" || fields.get("scope")?.startsWith("User") === true;
  const expectedHealth = agent !== "claude-code" || /\bConnected$/i.test(fields.get("status") ?? "");
  const expectedTransport = (fields.get(agent === "claude-code" ? "type" : "transport") ?? "").toLowerCase() === "stdio";
  const expectedCommand = fields.get("command") === launcher.command;
  const expectedArgs = fields.get("args") === launcher.args.join(" ");
  return expectedScope && expectedHealth && expectedTransport && expectedCommand && expectedArgs
    ? { agent, state: "current" }
    : { agent, state: "conflict", detail: `existing ${mcpServerName} registration differs from the requested user-level bridge command` };
}

function installOne(agent: SkillAgent, options: McpServiceOptions): McpTargetResult {
  const runner = options.runner ?? systemRunner;
  const planned = planInstall(agent, options, runner);
  if (planned.change.action !== "created" || options.dryRun) return planned;

  const command = agentCommand(agent);
  const added = runner(command, addArgs(agent, options.launcher));
  if (added.error) return result(agent, "refused", false, added.error.message);
  if (added.status !== 0) return result(agent, "refused", false, commandFailure(command, "register", added));
  const verified = inspectMcp(agent, options.launcher, runner);
  if (verified.state !== "current") {
    const removed = runner(command, removeArgs(agent));
    const verificationFailure = verified.detail ?? "registration could not be verified";
    if (removed.error) return result(agent, "refused", false, `${verificationFailure}; rollback failed: ${removed.error.message}`);
    if (removed.status !== 0) {
      return result(agent, "refused", false, `${verificationFailure}; ${commandFailure(command, "roll back", removed)}`);
    }
    return result(agent, "refused", false, `${verificationFailure}; newly added registration was rolled back`);
  }
  return result(agent, "created", false);
}

function planInstall(agent: SkillAgent, options: McpServiceOptions, runner: McpCommandRunner): McpTargetResult {
  const registration = inspectMcp(agent, options.launcher, runner);
  if (registration.state === "current") return result(agent, "unchanged", options.dryRun);
  if (registration.state === "absent") return result(agent, "created", options.dryRun);
  return result(agent, "refused", options.dryRun, registration.detail ?? `could not inspect ${mcpServerName}`);
}

function rollbackCreated(
  applied: McpTargetResult[],
  options: McpServiceOptions,
  runner: McpCommandRunner,
  failure: string,
): McpTargetResult[] {
  const rollbackOptions = { ...options, dryRun: false, runner };
  return applied.map((entry) => {
    if (!entry.ok || entry.change.action !== "created") return entry;
    const rolledBack = uninstallOne(entry.agent, rollbackOptions);
    const reason = rolledBack.ok
      ? `registration rolled back because another agent failed: ${failure}`
      : `registration rollback failed after another agent failed: ${rolledBack.change.reason ?? failure}`;
    return result(entry.agent, "refused", false, reason);
  });
}

function uninstallOne(agent: SkillAgent, options: McpServiceOptions): McpTargetResult {
  const runner = options.runner ?? systemRunner;
  const registration = inspectMcp(agent, options.launcher, runner);
  if (registration.state === "absent") return result(agent, "unchanged", options.dryRun);
  if (registration.state !== "current") return result(agent, "refused", options.dryRun, registration.detail ?? `could not inspect ${mcpServerName}`);
  if (options.dryRun) return result(agent, "removed", true);

  const command = agentCommand(agent);
  const removed = runner(command, removeArgs(agent));
  if (removed.error) return result(agent, "refused", false, removed.error.message);
  if (removed.status !== 0) return result(agent, "refused", false, commandFailure(command, "remove", removed));
  const verified = inspectMcp(agent, options.launcher, runner);
  if (verified.state !== "absent") return result(agent, "refused", false, verified.detail ?? "removal could not be verified");
  return result(agent, "removed", false);
}

function forAgents(target: McpTarget, operation: (agent: SkillAgent) => McpTargetResult): McpTargetResult[] {
  return agentsFor(target).map(operation);
}

function agentsFor(target: McpTarget): SkillAgent[] {
  return target === "all" ? allAgents : [target];
}

function result(agent: SkillAgent, action: FileChange["action"], dryRun: boolean, reason?: string): McpTargetResult {
  return { agent, ok: action !== "refused", dryRun, change: { path: `${agent} MCP registration (${mcpServerName})`, action, ...(reason ? { reason } : {}) } };
}

function agentCommand(agent: SkillAgent): "codex" | "claude" {
  return agent === "codex" ? "codex" : "claude";
}

function getArgs(_agent: SkillAgent): string[] {
  return ["mcp", "get", mcpServerName];
}

function addArgs(agent: SkillAgent, launcher: McpLauncher): string[] {
  return agent === "codex"
    ? ["mcp", "add", mcpServerName, "--", launcher.command, ...launcher.args]
    : ["mcp", "add", "--scope", "user", "--transport", "stdio", mcpServerName, "--", launcher.command, ...launcher.args];
}

function removeArgs(agent: SkillAgent): string[] {
  return agent === "codex" ? ["mcp", "remove", mcpServerName] : ["mcp", "remove", "--scope", "user", mcpServerName];
}

function commandFailure(command: string, action: string, result: McpCommandResult): string {
  const output = `${result.stderr}\n${result.stdout}`.trim();
  return output === "" ? `${command} failed to ${action} ${mcpServerName}` : `${command} failed to ${action} ${mcpServerName}: ${output}`;
}

function registrationFields(output: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z]+):\s*(.*?)\s*$/);
    if (match?.[1] && match[2] !== undefined) fields.set(match[1].toLowerCase(), match[2]);
  }
  return fields;
}

function isMissingServerOutput(output: string): boolean {
  return /(?:^|\n)(?:Error:\s*)?No MCP server named ['"]hermes-action['"](?: found)?\./i.test(output)
    || /(?:^|\n)(?:Error:\s*)?MCP server ['"]hermes-action['"] not found\b/i.test(output);
}

function systemRunner(command: string, args: string[]): McpCommandResult {
  const process = spawnSync(command, args, { encoding: "utf8", timeout: versionProbeTimeoutMs });
  const error = process.error ? { code: (process.error as NodeJS.ErrnoException).code, message: process.error.message } : undefined;
  return { status: process.status, stdout: process.stdout ?? "", stderr: process.stderr ?? "", ...(error ? { error } : {}) };
}
