/// <reference types="node" />

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const cli = join(process.cwd(), "src", "cli.ts");

describe("MCP server", () => {
  it("exposes bridge tools and checks configured Hermes status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-mcp-"));
    const fakeHermes = join(dir, "fake-hermes.js");
    writeFileSync(
      fakeHermes,
      [
        "#!/usr/bin/env node",
        "if (process.argv.includes('--version')) { console.log('Fake Hermes 1.0.0'); process.exit(0); }",
        "console.log('fake hermes called');",
      ].join("\n"),
    );
    chmodSync(fakeHermes, 0o755);
    const configPath = join(dir, ".hermes-action.yaml");
    writeFileSync(
      configPath,
      [
        "runtime:",
        `  command: ${JSON.stringify(fakeHermes)}`,
        "presets:",
        "  default:",
        "    skills: []",
        "    toolsets: []",
      ].join("\n"),
    );

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", cli, "mcp", "--config", configPath],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    const client = new Client({ name: "hermes-action-test", version: "0.1.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["hermes_run", "hermes_plan", "hermes_presets", "hermes_status"]));
      const status = await client.callTool({ name: "hermes_status", arguments: {} });
      const content = status.content as Array<{ type: string; text?: string }> | undefined;
      const first = content?.at(0);
      const text = first?.type === "text" ? first.text ?? "" : "";
      expect(text).toContain("Fake Hermes 1.0.0");
    } finally {
      await client.close();
    }
  }, 15_000);

  it("marks a failed Hermes run as an MCP error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-mcp-fail-"));
    const fakeHermes = join(dir, "fake-hermes.js");
    writeFileSync(
      fakeHermes,
      ["#!/usr/bin/env node", "console.log('partial progress');", "console.error('hermes boom');", "process.exit(2);"].join("\n"),
    );
    chmodSync(fakeHermes, 0o755);
    const configPath = join(dir, ".hermes-action.yaml");
    writeFileSync(
      configPath,
      ["runtime:", `  command: ${JSON.stringify(fakeHermes)}`, "presets:", "  default:", "    skills: []", "    toolsets: []"].join("\n"),
    );

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", cli, "mcp", "--config", configPath],
      cwd: process.cwd(),
      stderr: "pipe",
    });
    const client = new Client({ name: "hermes-action-test", version: "0.1.0" });
    await client.connect(transport);
    try {
      const result = await client.callTool({ name: "hermes_run", arguments: { prompt: "do something", mode: "plan" } });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }> | undefined;
      const text = content?.at(0)?.text ?? "";
      expect(text).toContain("hermes boom");
      expect(text).toContain("partial progress");
    } finally {
      await client.close();
    }
  }, 15_000);
});
