import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { buildEffectiveRun } from "./run.js";
import { runHermesCli } from "./adapters/hermes-cli.js";
import { checkHermesStatus } from "./status.js";
import { version } from "./version.js";
import type { BridgeConfig, BridgeMode } from "./types.js";

const modeSchema = z.enum(["plan", "draft", "execute", "request-approval"]);

type BridgeToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

/**
 * Single error boundary for every tool handler: any thrown error (bad preset,
 * missing/oversized context, adapter failure, serialization) becomes a clean
 * structured MCP error instead of crashing the server.
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
}

async function delegate(config: BridgeConfig, options: DelegateOptions): Promise<BridgeToolResult> {
  const dryRun = options.dryRun ?? false;
  const run = buildEffectiveRun(config, {
    prompt: options.prompt,
    mode: options.mode,
    preset: options.preset,
    contextFiles: options.contextFiles ?? [],
    yolo: options.yolo ?? false,
    dryRun,
    json: false,
  });
  const result = await runHermesCli(config, run, dryRun);
  const sections = [result.stdout, result.stderr].filter((section) => section.trim().length > 0);
  const text = sections.length > 0 ? sections.join("\n") : `Hermes exited with code ${result.exitCode}`;
  const content = [{ type: "text" as const, text }];
  return result.ok ? { content } : { content, isError: true };
}

export async function startMcpServer(configPath?: string): Promise<void> {
  const config = loadConfig(process.cwd(), configPath);
  const server = new McpServer({ name: "hermes-action-bridge", version });

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
    (args) =>
      guard(() =>
        delegate(config, {
          prompt: args.prompt,
          mode: args.mode as BridgeMode | undefined,
          preset: args.preset,
          contextFiles: args.contextFiles,
          yolo: args.yolo,
          dryRun: args.dryRun,
        }),
      ),
  );

  server.registerTool(
    "hermes_plan",
    {
      title: "Ask Hermes for a plan",
      description: "Shortcut for hermes_run with mode=plan.",
      inputSchema: { prompt: z.string().min(1), preset: z.string().optional(), contextFiles: z.array(z.string()).optional() },
    },
    (args) =>
      guard(() =>
        delegate(config, {
          prompt: args.prompt,
          mode: "plan",
          preset: args.preset,
          contextFiles: args.contextFiles,
        }),
      ),
  );

  server.registerTool(
    "hermes_presets",
    {
      title: "List presets",
      description: "List configured hermes-action-bridge presets.",
    },
    () => guard(() => ({ content: [{ type: "text", text: JSON.stringify(config.presets, null, 2) }] })),
  );

  server.registerTool(
    "hermes_status",
    {
      title: "Check Hermes runtime status",
      description: "Check whether the configured Hermes command is available.",
    },
    () => guard(() => ({ content: [{ type: "text", text: JSON.stringify(checkHermesStatus(config), null, 2) }] })),
  );

  await server.connect(new StdioServerTransport());
}
