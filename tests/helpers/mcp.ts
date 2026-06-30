/// <reference types="node" />

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cli = join(process.cwd(), "src", "cli.ts");

/**
 * Write a fake `hermes` executable (Node script body, no shebang) plus a project
 * config pointing the bridge at it, and return the config path. The default
 * config exposes a single empty `default` preset; pass `configBody` to override
 * the YAML below the `runtime:` block.
 */
export function writeFakeHermesConfig(fakeHermesBody: string, configBody?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hermes-action-mcp-"));
  const fakeHermes = join(dir, "fake-hermes.js");
  writeFileSync(fakeHermes, `#!/usr/bin/env node\n${fakeHermesBody}`);
  chmodSync(fakeHermes, 0o755);
  const config = configBody ?? ["presets:", "  default:", "    skills: []", "    toolsets: []"].join("\n");
  const configPath = join(dir, ".hermes-action.yaml");
  writeFileSync(configPath, `runtime:\n  command: ${JSON.stringify(fakeHermes)}\n${config}\n`);
  return configPath;
}

/** Spawn the bridge MCP server with the given config, run `fn` against a connected client, and always close. */
export async function withMcpClient<T>(configPath: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", cli, "mcp", "--config", configPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "hermes-action-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** Extract the first text block from a tool result (accepts the SDK's union result type). */
export function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  return content?.find((block) => block.type === "text")?.text ?? "";
}
