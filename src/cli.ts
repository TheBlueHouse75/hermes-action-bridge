#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { Argument, Command, Option } from "commander";
import { defaultProjectConfig, loadConfig } from "./config.js";
import { buildEffectiveRun } from "./run.js";
import { runHermesCli } from "./adapters/hermes-cli.js";
import { checkHermesStatus } from "./status.js";
import { startMcpServer } from "./mcp-server.js";
import { version } from "./version.js";
import { installHint, installSkills, previewSkills, uninstallHint, uninstallSkills, type ServiceOptions, type SkillTarget, type TargetResult } from "./install/install-service.js";
import { mcpSnippets, removeMcpJson, writeMcpJson } from "./install/mcp-config.js";
import { coreChecks, formatDoctor, probeCheck, toReport } from "./doctor.js";
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
  .option("--profile <name>", "Hermes profile")
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
      profile: options.profile,
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
  .description("Run an MCP server exposing hermes_run, hermes_plan, hermes_presets, and hermes_status")
  .option("--config <path>", "config file path")
  .action(async (options: { config?: string }) => {
    await startMcpServer(options.config);
  });

program
  .command("install")
  .description("Install the hermes-action-bridge skill (or print/write MCP config) for a coding agent")
  .addArgument(new Argument("<target>", "which agent").choices(["claude-code", "codex", "all", "mcp"]))
  .option("--project", "install a project-local skill instead of the global one", false)
  .option("--project-hint", "also add a hint block to CLAUDE.md / AGENTS.md", false)
  .option("--mcp", "also print the MCP config snippets", false)
  .option("--write", "for the mcp target, write/merge the project .mcp.json (Claude Code)", false)
  .option("--force", "replace an existing managed skill", false)
  .option("--dry-run", "print planned operations, write nothing", false)
  .option("--print", "print the generated skill content, write nothing", false)
  .option("--yes", "non-interactive", false)
  .action((target: string, options: InstallCommandOptions) => {
    const ctx = pathContext();
    if (target === "mcp") {
      if (options.write) reportChange(writeMcpJson(mcpJsonPath(ctx), options.dryRun), options.dryRun);
      else printMcpSnippets();
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
    const results = installSkills(skillTarget, ctx, opts);
    if (options.projectHint) results.push(...installHint(skillTarget, ctx, opts));
    reportResults(results, options.dryRun);
    if (options.mcp) printMcpSnippets();
  });

program
  .command("uninstall")
  .description("Remove the hermes-action-bridge skill (or MCP config) for a coding agent")
  .addArgument(new Argument("<target>", "which agent").choices(["claude-code", "codex", "all", "mcp"]))
  .option("--project", "remove a project-local skill instead of the global one", false)
  .option("--project-hint", "also remove the CLAUDE.md / AGENTS.md hint block", false)
  .option("--write", "for the mcp target, remove hermes-action from the project .mcp.json", false)
  .option("--force", "remove even a locally modified skill", false)
  .option("--dry-run", "print planned removals, write nothing", false)
  .option("--yes", "non-interactive", false)
  .action((target: string, options: UninstallCommandOptions) => {
    const ctx = pathContext();
    if (target === "mcp") {
      if (options.write) reportChange(removeMcpJson(mcpJsonPath(ctx), options.dryRun), options.dryRun);
      else console.log("Use --write to remove hermes-action from the project .mcp.json.");
      return;
    }
    const skillTarget = target as SkillTarget;
    const scope: InstallScope = options.project ? "project" : "global";
    const opts = serviceOptions(options, scope);
    const results = uninstallSkills(skillTarget, ctx, opts);
    if (options.projectHint) results.push(...uninstallHint(skillTarget, ctx, opts));
    reportResults(results, options.dryRun);
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
    const checks = coreChecks(config, ctx, configError);
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
  profile?: string;
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
