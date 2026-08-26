import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toolText, withMcpClient, writeFakeHermesConfig } from "./helpers/mcp.js";

const markerBody = [
  "const { appendFileSync } = require('node:fs');",
  "const { join } = require('node:path');",
  "appendFileSync(join(__dirname, 'executions.log'), 'executed\\n');",
].join("\n");

function markerPath(configPath: string): string {
  return join(dirname(configPath), "executions.log");
}

describe("security: MCP execution approval gate", () => {
  it("blocks same-session prepare/approve when the client cannot elicit human input", async () => {
    const configPath = writeFakeHermesConfig(markerBody);

    await withMcpClient(configPath, async (client) => {
      const prepared = JSON.parse(toolText(await client.callTool({
        name: "hermes_prepare",
        arguments: { prompt: "publish the release note to #general" },
      }))) as { id: string };

      const approved = await client.callTool({
        name: "hermes_approve",
        arguments: { approvalId: prepared.id },
      });
      expect(approved.isError).toBe(true);
      expect(toolText(approved)).toContain("client does not support it");
      expect(existsSync(markerPath(configPath))).toBe(false);

      const rejected = JSON.parse(toolText(await client.callTool({
        name: "hermes_reject",
        arguments: { approvalId: prepared.id },
      }))) as { status: string };
      expect(rejected.status).toBe("rejected");
    });

    const audit = readFileSync(join(dirname(configPath), "audit.jsonl"), "utf8");
    expect(audit).not.toContain('"phase":"approved"');
    expect(audit).not.toContain('"phase":"submitted"');
  }, 15_000);

  it("blocks direct MCP execute requests even when YOLO bypasses policy", async () => {
    const configPath = writeFakeHermesConfig(markerBody);

    await withMcpClient(configPath, async (client) => {
      const result = await client.callTool({
        name: "hermes_run",
        arguments: { prompt: "publish without review", mode: "execute", yolo: true },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("interactive form elicitation");
    });

    expect(existsSync(markerPath(configPath))).toBe(false);
  }, 15_000);

  it("blocks direct MCP execute requests from trusted presets", async () => {
    const configPath = writeFakeHermesConfig(markerBody, [
      "presets:",
      "  trusted:",
      "    skills: []",
      "    toolsets: []",
      "    require_approval_for: []",
    ].join("\n"));

    await withMcpClient(configPath, async (client) => {
      const result = await client.callTool({
        name: "hermes_run",
        arguments: { prompt: "publish from trusted preset", mode: "execute", preset: "trusted" },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("interactive form elicitation");
    });

    expect(existsSync(markerPath(configPath))).toBe(false);
  }, 15_000);

  it("preserves confirmed direct MCP execution", async () => {
    const configPath = writeFakeHermesConfig(markerBody);
    let confirmationMessage = "";

    await withMcpClient(configPath, async (client) => {
      const result = await client.callTool({
        name: "hermes_run",
        arguments: { prompt: "publish after review", mode: "execute", yolo: true },
      });
      expect(result.isError).not.toBe(true);
      expect(confirmationMessage).toContain("publish after review");
      expect(existsSync(markerPath(configPath))).toBe(true);
    }, {
      elicitation: (params) => {
        confirmationMessage = params.message;
        return { action: "accept", content: { confirm: true } };
      },
    });
  }, 15_000);

  it("does not require confirmation for a non-executing dry run", async () => {
    const configPath = writeFakeHermesConfig(markerBody);

    await withMcpClient(configPath, async (client) => {
      const result = await client.callTool({
        name: "hermes_run",
        arguments: { prompt: "inspect an execute request", mode: "execute", yolo: true, dryRun: true },
      });
      expect(result.isError).not.toBe(true);
      expect(toolText(result)).toContain("Mode: execute");
    });

    expect(existsSync(markerPath(configPath))).toBe(false);
  }, 15_000);

  it("fails closed when the human declines without consuming the prepared action", async () => {
    const configPath = writeFakeHermesConfig(markerBody);

    await withMcpClient(configPath, async (client) => {
      const prepared = JSON.parse(toolText(await client.callTool({
        name: "hermes_prepare",
        arguments: { prompt: "send the external message" },
      }))) as { id: string };
      const result = await client.callTool({
        name: "hermes_approve",
        arguments: { approvalId: prepared.id },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("was declined");
      expect(existsSync(markerPath(configPath))).toBe(false);

      const rejected = JSON.parse(toolText(await client.callTool({
        name: "hermes_reject",
        arguments: { approvalId: prepared.id },
      }))) as { status: string };
      expect(rejected.status).toBe("rejected");
    }, {
      elicitation: () => ({ action: "decline" }),
    });
  }, 15_000);

  it("revalidates approval state after the interactive confirmation", async () => {
    const configPath = writeFakeHermesConfig(markerBody);
    let markElicitationStarted = (): void => undefined;
    let releaseConfirmation = (): void => undefined;
    const elicitationStarted = new Promise<void>((resolve) => {
      markElicitationStarted = resolve;
    });
    const confirmationReleased = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });

    await withMcpClient(configPath, async (client) => {
      const prepared = JSON.parse(toolText(await client.callTool({
        name: "hermes_prepare",
        arguments: { prompt: "publish after delayed confirmation" },
      }))) as { id: string };

      const approvalResult = client.callTool({
        name: "hermes_approve",
        arguments: { approvalId: prepared.id },
      });
      await elicitationStarted;
      const rejected = JSON.parse(toolText(await client.callTool({
        name: "hermes_reject",
        arguments: { approvalId: prepared.id },
      }))) as { status: string };
      expect(rejected.status).toBe("rejected");
      releaseConfirmation();

      const result = await approvalResult;
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("Unknown approval");
      expect(existsSync(markerPath(configPath))).toBe(false);
    }, {
      elicitation: async () => {
        markElicitationStarted();
        await confirmationReleased;
        return { action: "accept", content: { confirm: true } };
      },
    });
  }, 15_000);
});
