#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command, Option } from "commander";
import { defaultProjectConfig, loadConfig } from "./config.js";
import { buildEffectiveRun } from "./run.js";
import { runHermesCli } from "./adapters/hermes-cli.js";
import { checkHermesStatus } from "./status.js";
import { startMcpServer } from "./mcp-server.js";
import { version } from "./version.js";
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
