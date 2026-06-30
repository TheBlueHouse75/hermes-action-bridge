import { describe, expect, it } from "vitest";
import { toolText, withMcpClient, writeFakeHermesConfig } from "./helpers/mcp.js";

/** A fake Hermes that bad-input cases never reach: buildEffectiveRun throws before any spawn. */
const FAKE_HERMES = "console.log('fake hermes called');";

async function runWithArgs(args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const configPath = writeFakeHermesConfig(FAKE_HERMES);
  return withMcpClient(configPath, async (client) => {
    const result = await client.callTool({ name: "hermes_run", arguments: args });
    return { isError: result.isError === true, text: toolText(result) };
  });
}

describe("MCP error boundaries", () => {
  it("returns a structured error for an unknown preset instead of crashing", async () => {
    const { isError, text } = await runWithArgs({ prompt: "do something", preset: "does-not-exist" });
    expect(isError).toBe(true);
    expect(text).toContain("Bridge error");
    expect(text).toContain("Unknown preset");
  }, 15_000);

  it("returns a structured error for a missing context file", async () => {
    const { isError, text } = await runWithArgs({ prompt: "do something", contextFiles: ["/nonexistent/handoff.md"] });
    expect(isError).toBe(true);
    expect(text).toContain("Bridge error");
  }, 15_000);
});
