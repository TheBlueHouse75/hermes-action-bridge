import { describe, expect, it } from "vitest";
import { toolText, withMcpClient, writeFakeHermesConfig } from "./helpers/mcp.js";

describe("MCP server", () => {
  it("exposes bridge tools and checks configured Hermes status", async () => {
    const configPath = writeFakeHermesConfig(
      "if (process.argv.includes('--version')) { console.log('Fake Hermes 1.0.0'); process.exit(0); }\nconsole.log('fake hermes called');",
    );
    await withMcpClient(configPath, async (client) => {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["hermes_run", "hermes_plan", "hermes_presets", "hermes_status"]),
      );
      const status = await client.callTool({ name: "hermes_status", arguments: {} });
      expect(toolText(status)).toContain("Fake Hermes 1.0.0");
    });
  }, 15_000);

  it("marks a failed Hermes run as an MCP error", async () => {
    const configPath = writeFakeHermesConfig(
      "console.log('partial progress');\nconsole.error('hermes boom');\nprocess.exit(2);",
    );
    await withMcpClient(configPath, async (client) => {
      const result = await client.callTool({ name: "hermes_run", arguments: { prompt: "do something", mode: "plan" } });
      expect(result.isError).toBe(true);
      const text = toolText(result);
      expect(text).toContain("hermes boom");
      expect(text).toContain("partial progress");
    });
  }, 15_000);
});
