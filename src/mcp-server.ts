import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { buildEffectiveRun } from "./run.js";
import { runHermesCli } from "./adapters/hermes-cli.js";
import { checkHermesStatus } from "./status.js";
import type { BridgeMode } from "./types.js";

const modeSchema = z.enum(["plan", "draft", "execute", "request-approval"]);

export async function startMcpServer(configPath?: string): Promise<void> {
  const server = new McpServer({ name: "hermes-action-bridge", version: "0.1.0" });

  server.registerTool(
    "hermes_run",
    {
      title: "Delegate a request to Hermes",
      description: "Run Hermes through the configured hermes-action-bridge policy and presets.",
      inputSchema: {
        prompt: z.string().min(1),
        mode: modeSchema.optional(),
        preset: z.string().optional(),
        contextFiles: z.array(z.string()).optional(),
        yolo: z.boolean().optional(),
        dryRun: z.boolean().optional(),
      },
    },
    async (args) => {
      const config = loadConfig(process.cwd(), configPath);
      const run = buildEffectiveRun(config, {
        prompt: args.prompt,
        mode: args.mode as BridgeMode | undefined,
        preset: args.preset,
        contextFiles: args.contextFiles || [],
        yolo: args.yolo || false,
        dryRun: args.dryRun || false,
        json: false,
      });
      const result = await runHermesCli(config, run, args.dryRun || false);
      return { content: [{ type: "text", text: result.stdout || result.stderr }] };
    },
  );

  server.registerTool(
    "hermes_plan",
    {
      title: "Ask Hermes for a plan",
      description: "Shortcut for hermes_run with mode=plan.",
      inputSchema: { prompt: z.string().min(1), preset: z.string().optional(), contextFiles: z.array(z.string()).optional() },
    },
    async (args) => {
      const config = loadConfig(process.cwd(), configPath);
      const run = buildEffectiveRun(config, {
        prompt: args.prompt,
        mode: "plan",
        preset: args.preset,
        contextFiles: args.contextFiles || [],
        yolo: false,
        dryRun: false,
        json: false,
      });
      const result = await runHermesCli(config, run, false);
      return { content: [{ type: "text", text: result.stdout || result.stderr }] };
    },
  );

  server.registerTool(
    "hermes_presets",
    {
      title: "List presets",
      description: "List configured hermes-action-bridge presets.",
    },
    () => {
      const config = loadConfig(process.cwd(), configPath);
      return { content: [{ type: "text", text: JSON.stringify(config.presets, null, 2) }] };
    },
  );

  server.registerTool(
    "hermes_status",
    {
      title: "Check Hermes runtime status",
      description: "Check whether the configured Hermes command is available.",
    },
    () => {
      const config = loadConfig(process.cwd(), configPath);
      return { content: [{ type: "text", text: JSON.stringify(checkHermesStatus(config), null, 2) }] };
    },
  );

  await server.connect(new StdioServerTransport());
}
