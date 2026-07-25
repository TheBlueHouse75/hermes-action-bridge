#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Argument, Command, Option } from "commander";
import { defaultProjectConfig, loadConfig } from "./config.js";
import { buildEffectiveRun } from "./run.js";
import { runHermesCli } from "./adapters/hermes-cli.js";
import { checkHermesStatus } from "./status.js";
import { startMcpServer } from "./mcp-server.js";
import { startBridgeHttpServer, type BridgeHttpHandle } from "./http-server.js";
import { version } from "./version.js";
import { installHint, installSkills, previewSkills, uninstallHint, uninstallSkills, type ServiceOptions, type SkillTarget, type TargetResult } from "./install/install-service.js";
import { bridgeMcpLauncher } from "./install/launcher.js";
import { mcpSnippets, removeMcpJson, writeMcpJson } from "./install/mcp-config.js";
import { installMcp, uninstallMcp, type McpLauncher, type McpTargetResult } from "./install/mcp-service.js";
import { coreChecks, formatDoctor, mcpHandshakeCheck, probeCheck, toReport } from "./doctor.js";
import type { FileChange, InstallScope, PathContext } from "./install/types.js";
import type { BridgeConfig } from "./types.js";
import type { BridgeMode } from "./types.js";

const program = new Command();
program
  .name("hermes-action")
  .description("Delegate actions from external agents to Hermes Agent through configurable policies and presets.")
  .version(version);

program
  .command("init")
  .description("Create a project .hermes-action.yaml config file")
  .option("-f, --file <path>", "config file path", ".hermes-action.yaml")
  .option("--force", "overwrite existing file", false)
  .action((options: { file: string; force: boolean }) => {
    const path = resolve(process.cwd(), options.file);
    mkdirSync(dirname(path), { recursive: true });
    if (!options.force) {
      try {
        writeFileSync(path, defaultProjectConfig(), { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`Config already exists: ${path}. Use --force to overwrite.`);
        }
        throw error;
      }
    } else {
      writeFileSync(path, defaultProjectConfig());
    }
    console.log(`Created ${path}`);
  });

program
  .command("run")
  .description("Delegate a request to Hermes")
  .argument("<prompt...>", "request for Hermes")
  .addOption(new Option("--mode <mode>", "execution mode").choices(["plan", "draft", "execute", "request-approval"]))
  .option("--preset <name>", "config preset")
  .option("--context <path...>", "context file(s) to include", [])
  .option("--config <path>", "config file path")
  .option("--provider <name>", "Hermes provider")
  .option("--model <name>", "Hermes model")
  .option("--max-turns <number>", "Hermes max tool-calling iterations", parsePositiveInt)
  .option("--timeout <seconds>", "max seconds before Hermes is terminated", parsePositiveInt)
  .option("--source <name>", "Hermes source tag")
  .option("--yolo", "bypass bridge policy and pass --yolo to Hermes", false)
  .option("--dry-run", "print the Hermes command and prompt without executing", false)
  .option("--json", "print structured JSON", false)
  .action(async (promptParts: string[], options: RunCommandOptions) => {
    const config = loadConfig(process.cwd(), options.config);
    const run = buildEffectiveRun(config, {
      prompt: promptParts.join(" "),
      mode: options.mode as BridgeMode | undefined,
      preset: options.preset,
      contextFiles: options.context || [],
      yolo: options.yolo,
      dryRun: options.dryRun,
      json: options.json,
      provider: options.provider,
      model: options.model,
      maxTurns: options.maxTurns,
      source: options.source,
      timeoutSeconds: options.timeout,
    });
    const result = await runHermesCli(config, run, options.dryRun);
    if (options.json) {
      console.log(JSON.stringify({ ...result, effective: { mode: run.mode, requestedMode: run.requestedMode, preset: run.presetName, yolo: run.yolo, detectedRisks: run.detectedRisks } }, null, 2));
    } else {
      if (result.stdout.trim()) console.log(result.stdout.trimEnd());
      if (result.stderr.trim()) console.error(result.stderr.trimEnd());
    }
    process.exitCode = result.exitCode;
  });

program
  .command("presets")
  .description("List configured presets")
  .option("--config <path>", "config file path")
  .option("--json", "print structured JSON", false)
  .action((options: { config?: string; json: boolean }) => {
    const config = loadConfig(process.cwd(), options.config);
    if (options.json) {
      console.log(JSON.stringify(config.presets, null, 2));
      return;
    }
    for (const [name, preset] of Object.entries(config.presets)) {
      console.log(`${name}${preset.description ? ` - ${preset.description}` : ""}`);
    }
  });

program
  .command("status")
  .description("Check the configured Hermes command")
  .option("--config <path>", "config file path")
  .option("--json", "print structured JSON", false)
  .action((options: { config?: string; json: boolean }) => {
    const config = loadConfig(process.cwd(), options.config);
    const status = checkHermesStatus(config);
    if (options.json) console.log(JSON.stringify(status, null, 2));
    else console.log(status.available ? `Hermes available: ${status.version}` : `Hermes unavailable: ${status.error}`);
    process.exitCode = status.available ? 0 : 1;
  });

program
  .command("mcp")
  .description("Run the local stdio MCP server")
  .option("--config <path>", "config file path")
  .action(async (options: { config?: string }) => {
    await startMcpServer(options.config);
  });

program
  .command("serve")
  .description("Run the opt-in Streamable HTTP MCP server")
  .option("--config <path>", "config file path")
  .option("--listen <address>", "listen address", "127.0.0.1")
  .option("--port <number>", "listen port", parsePort, 8765)
  .option("--allow-tailnet", "allow direct listening on a Tailscale 100.64.0.0/10 address", false)
  .option("--token-env <name>", "environment variable containing a bearer token")
  .action(async (options: ServeCommandOptions) => {
    const config = loadConfig(process.cwd(), options.config);
    const handle = await startBridgeHttpServer({
      config,
      listen: options.listen,
      port: options.port,
      allowTailnet: options.allowTailnet,
      tokenEnv: options.tokenEnv,
    });
    console.log(`Hermes Action Bridge HTTP MCP listening on http://${handle.host}:${handle.port}/mcp`);
    await waitForShutdown(handle);
  });

program
  .command("install")
  .description("Install the Hermes skill and MCP server for a coding agent")
  .addArgument(new Argument("<target>", "which agent").choices(["claude-code", "codex", "all", "mcp"]))
  .option("--project", "install a project-local skill instead of the global one", false)
  .option("--project-hint", "also add a hint block to CLAUDE.md / AGENTS.md", false)
  .option("--mcp", "with --project, also print MCP config snippets", false)
  .option("--write", "for the mcp target, write/merge the project .mcp.json instead of global registration", false)
  .option("--force", "replace an existing managed skill", false)
  .option("--dry-run", "print planned operations, write nothing", false)
  .option("--print", "print the generated skill content, write nothing", false)
  .option("--yes", "non-interactive", false)
  .action((target: string, options: InstallCommandOptions) => {
    const ctx = pathContext();
    if (target === "mcp") {
      if (options.write) reportChange(writeMcpJson(mcpJsonPath(ctx), options.dryRun), options.dryRun);
      else reportMcpResults(installMcp("all", { launcher: bridgeLauncher(), dryRun: options.dryRun }));
      return;
    }
    const skillTarget = target as SkillTarget;
    const scope: InstallScope = options.project ? "project" : "global";
    if (options.print) {
      for (const preview of previewSkills(skillTarget, ctx, scope)) {
        for (const file of preview.files) {
          console.log(`# ${preview.agent} -> ${file.path}`);
          console.log(file.content);
        }
      }
      return;
    }
    const opts = serviceOptions(options, scope);
    if (options.project) {
      const results = installSkills(skillTarget, ctx, opts);
      if (options.projectHint) results.push(...installHint(skillTarget, ctx, opts));
      reportResults(results, options.dryRun);
      if (options.mcp) printMcpSnippets();
      return;
    }
    installGlobalAgentIntegration(skillTarget, ctx, opts, options.projectHint);
  });

program
  .command("uninstall")
  .description("Remove the managed Hermes skill and MCP registration for a coding agent")
  .addArgument(new Argument("<target>", "which agent").choices(["claude-code", "codex", "all", "mcp"]))
  .option("--project", "remove a project-local skill instead of the global one", false)
  .option("--project-hint", "also remove the CLAUDE.md / AGENTS.md hint block", false)
  .option("--write", "for the mcp target, remove hermes-action from the project .mcp.json instead of global registration", false)
  .option("--force", "remove even a locally modified skill", false)
  .option("--dry-run", "print planned removals, write nothing", false)
  .option("--yes", "non-interactive", false)
  .action((target: string, options: UninstallCommandOptions) => {
    const ctx = pathContext();
    if (target === "mcp") {
      if (options.write) reportChange(removeMcpJson(mcpJsonPath(ctx), options.dryRun), options.dryRun);
      else reportMcpResults(uninstallMcp("all", { launcher: bridgeLauncher(), dryRun: options.dryRun }));
      return;
    }
    const skillTarget = target as SkillTarget;
    const scope: InstallScope = options.project ? "project" : "global";
    const opts = serviceOptions(options, scope);
    const results = uninstallSkills(skillTarget, ctx, opts);
    if (options.projectHint) results.push(...uninstallHint(skillTarget, ctx, opts));
    reportResults(results, options.dryRun);
    if (!options.project) reportMcpResults(uninstallMcp(skillTarget, { launcher: bridgeLauncher(), dryRun: options.dryRun }));
  });

program
  .command("doctor")
  .description("Check the environment for using hermes-action and its skills")
  .option("--config <path>", "config file path")
  .option("--json", "print structured JSON", false)
  .option("--probe", "additionally run a live Hermes plan call (spends provider tokens)", false)
  .action(async (options: { config?: string; json: boolean; probe: boolean }) => {
    const ctx = pathContext();
    let config: BridgeConfig | null = null;
    let configError: string | undefined;
    try {
      config = loadConfig(ctx.cwd, options.config);
    } catch (error) {
      configError = error instanceof Error ? error.message : String(error);
    }
    const checks = coreChecks(config, ctx, configError, { launcher: bridgeLauncher() });
    if (config) checks.push(await mcpHandshakeCheck(config));
    if (options.probe && config) {
      try {
        checks.push(await probeCheck(config));
      } catch (error) {
        checks.push({ id: "probe", status: "warn", detail: error instanceof Error ? error.message : String(error) });
      }
    }
    const report = toReport(checks);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatDoctor(report));
    process.exitCode = report.ok ? 0 : 1;
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

interface RunCommandOptions {
  mode?: string;
  preset?: string;
  context?: string[];
  config?: string;
  provider?: string;
  model?: string;
  maxTurns?: number;
  timeout?: number;
  source?: string;
  yolo: boolean;
  dryRun: boolean;
  json: boolean;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, got: ${value}`);
  return parsed;
}

function parsePort(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) throw new Error(`Expected a port from 1 to 65535, got: ${value}`);
  return parsed;
}

interface ServeCommandOptions {
  config?: string;
  listen: string;
  port: number;
  allowTailnet: boolean;
  tokenEnv?: string;
}

interface InstallCommandOptions {
  project: boolean;
  projectHint: boolean;
  mcp: boolean;
  write: boolean;
  force: boolean;
  dryRun: boolean;
  print: boolean;
  yes: boolean;
}

type UninstallCommandOptions = Omit<InstallCommandOptions, "mcp" | "print">;

function pathContext(): PathContext {
  return { homeDir: homedir(), cwd: process.cwd() };
}

function mcpJsonPath(ctx: PathContext): string {
  return resolve(ctx.cwd, ".mcp.json");
}

/** Resolve the installed launcher target once so MCP clients do not depend on an interactive shell PATH. */
function bridgeLauncher(): McpLauncher {
  const script = process.argv[1];
  if (!script) throw new Error("Could not resolve the hermes-action executable path.");
  return bridgeMcpLauncher(realpathSync(resolve(script)));
}

function serviceOptions(options: { force: boolean; dryRun: boolean }, scope: InstallScope): ServiceOptions {
  return { scope, force: options.force, dryRun: options.dryRun };
}

function printMcpSnippets(): void {
  for (const snippet of mcpSnippets()) {
    console.log(`# ${snippet.client} (${snippet.location})`);
    console.log(snippet.content);
  }
}

function reportChange(change: FileChange, dryRun: boolean): void {
  if (change.action === "refused") {
    console.error(`refused (${change.reason ?? "unknown reason"})`);
    process.exitCode = 1;
  } else {
    console.log(`${change.action} ${change.path}${dryRun ? " (dry-run)" : ""}`);
  }
}

function reportResults(results: TargetResult[], dryRun: boolean): void {
  for (const result of results) {
    if (result.changes.length === 0) {
      console.log(`${result.agent}: nothing to do`);
      continue;
    }
    for (const change of result.changes) {
      if (change.action === "refused") {
        console.error(`${result.agent}: refused (${change.reason ?? "unknown reason"})`);
      } else {
        console.log(`${result.agent}: ${change.action} ${change.path}${dryRun ? " (dry-run)" : ""}`);
      }
    }
  }
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
}

function reportMcpResults(results: McpTargetResult[]): void {
  for (const result of results) {
    const { change } = result;
    if (change.action === "refused") {
      console.error(`${result.agent} MCP: refused (${change.reason ?? "unknown reason"})`);
    } else {
      console.log(`${result.agent} MCP: ${change.action}${result.dryRun ? " (dry-run)" : ""}`);
    }
  }
  if (!results.every((result) => result.ok)) process.exitCode = 1;
}

/**
 * Refuse the whole global install before writing when either a skill or MCP
 * registration conflicts. Native agent CLIs remain the source of truth for
 * MCP configuration, while the preflight prevents a predictable half-install.
 */
function installGlobalAgentIntegration(
  target: SkillTarget,
  ctx: PathContext,
  options: ServiceOptions,
  includeProjectHint: boolean,
): void {
  const launcher = bridgeLauncher();
  const preflightOptions = { ...options, dryRun: true };
  const skillPlan = installSkills(target, ctx, preflightOptions);
  const hintPlan = includeProjectHint ? installHint(target, ctx, preflightOptions) : [];
  const filePlan = [...skillPlan, ...hintPlan];
  const mcpPlan = installMcp(target, { launcher, dryRun: true });
  if (!filePlan.every((result) => result.ok) || !mcpPlan.every((result) => result.ok)) {
    reportResults(filePlan, true);
    reportMcpResults(mcpPlan);
    return;
  }
  if (options.dryRun) {
    reportResults(filePlan, true);
    reportMcpResults(mcpPlan);
    return;
  }

  const installSnapshot = captureInstallSnapshot(skillPlan, hintPlan);
  const mcpResults = installMcp(target, { launcher, dryRun: false });
  if (!mcpResults.every((result) => result.ok)) {
    reportMcpResults(mcpResults);
    return;
  }
  const skillResults = installSkills(target, ctx, options);
  const hintResults = includeProjectHint ? installHint(target, ctx, options) : [];
  const fileResults = [...skillResults, ...hintResults];
  if (!fileResults.every((result) => result.ok)) {
    reportResults(fileResults, false);
    restoreInstallSnapshot(installSnapshot);
    rollbackCreatedMcp(mcpResults, launcher);
    process.exitCode = 1;
    return;
  }
  reportResults(fileResults, false);
  reportMcpResults(mcpResults);
}

interface FileSnapshot {
  path: string;
  existed: boolean;
  content?: Buffer | undefined;
  mode?: number | undefined;
}

interface InstallSnapshot {
  files: Map<string, FileSnapshot>;
  skillDirs: Set<string>;
}

function captureInstallSnapshot(skillPlan: TargetResult[], hintPlan: TargetResult[]): InstallSnapshot {
  const files = new Map<string, FileSnapshot>();
  const skillDirs = new Set<string>();
  for (const result of skillPlan) {
    if (!result.changes.some(isWriteAction)) continue;
    for (const change of result.changes) {
      const dir = dirname(change.path);
      skillDirs.add(dir);
      captureFile(files, change.path);
      captureFile(files, join(dir, ".hermes-action-managed.json"));
    }
  }
  for (const result of hintPlan) {
    for (const change of result.changes.filter(isWriteAction)) captureFile(files, change.path);
  }
  return { files, skillDirs };
}

function captureFile(snapshots: Map<string, FileSnapshot>, path: string): void {
  if (snapshots.has(path)) return;
  if (!existsSync(path)) {
    snapshots.set(path, { path, existed: false });
    return;
  }
  snapshots.set(path, {
    path,
    existed: true,
    content: readFileSync(path),
    mode: statSync(path).mode & 0o777,
  });
}

function restoreInstallSnapshot(snapshot: InstallSnapshot): void {
  console.error("Restoring skill and instruction files changed by this failed install.");
  for (const [path, file] of snapshot.files) {
    try {
      restoreFile(file);
    } catch (error) {
      console.error(`Rollback could not restore ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const dir of snapshot.skillDirs) {
    try {
      rmdirSync(dir);
    } catch {
      // Removing an empty directory is cosmetic; never remove a non-empty or concurrently changed directory.
    }
  }
}

function restoreFile(snapshot: FileSnapshot): void {
  if (!snapshot.existed) {
    if (existsSync(snapshot.path)) unlinkSync(snapshot.path);
    return;
  }
  if (!snapshot.content || snapshot.mode === undefined) throw new Error(`Incomplete rollback snapshot: ${snapshot.path}`);
  mkdirSync(dirname(snapshot.path), { recursive: true });
  writeFileSync(snapshot.path, snapshot.content);
  chmodSync(snapshot.path, snapshot.mode);
}

function isWriteAction(change: FileChange): boolean {
  return change.action === "created" || change.action === "updated";
}

function rollbackCreatedMcp(results: McpTargetResult[], launcher: McpLauncher): void {
  const created = results.filter((result) => result.change.action === "created");
  if (created.length === 0) return;
  console.error("Rolling back MCP registrations created by this failed install.");
  for (const result of created) {
    reportMcpResults(uninstallMcp(result.agent, { launcher, dryRun: false }));
  }
}

function waitForShutdown(handle: BridgeHttpHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      void handle.close().then(resolve, reject);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
