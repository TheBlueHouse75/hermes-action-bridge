import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
        expect.arrayContaining([
          "hermes_run",
          "hermes_plan",
          "hermes_capabilities",
          "hermes_presets",
          "hermes_status",
          "hermes_submit",
          "hermes_job_status",
          "hermes_result",
          "hermes_cancel",
          "hermes_prepare",
          "hermes_approve",
          "hermes_reject",
        ]),
      );
      const status = await client.callTool({ name: "hermes_status", arguments: {} });
      expect(toolText(status)).toContain("Fake Hermes 1.0.0");
    });
  }, 15_000);

  it("forwards model and maxTurns overrides to the Hermes command", async () => {
    const configPath = writeFakeHermesConfig("console.log(process.argv.slice(2).join(' '));");
    await withMcpClient(configPath, async (client) => {
      const result = await client.callTool({
        name: "hermes_run",
        arguments: { prompt: "do it", mode: "plan", model: "fast-model", maxTurns: 7 },
      });
      const text = toolText(result);
      expect(text).toContain("--model fast-model");
      expect(text).toContain("--max-turns 7");
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

  it("submits and retrieves a bounded asynchronous result", async () => {
    const configPath = writeFakeHermesConfig("console.log('async result');");
    await withMcpClient(configPath, async (client) => {
      const submitted = JSON.parse(
        toolText(await client.callTool({ name: "hermes_submit", arguments: { prompt: "do async work", mode: "plan" } })),
      ) as { id: string; status: string };
      expect(["queued", "running"]).toContain(submitted.status);

      let result: { status: string; output?: { stdout: string } } | undefined;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        result = JSON.parse(
          toolText(await client.callTool({ name: "hermes_result", arguments: { jobId: submitted.id } })),
        ) as { status: string; output?: { stdout: string } };
        if (result.status === "succeeded") break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(result).toMatchObject({ status: "succeeded", output: { stdout: expect.stringContaining("async result") } });
    });
  }, 15_000);

  it("disables global YOLO for submitted execute jobs", async () => {
    const configPath = writeFakeHermesConfig(
      "console.log(process.argv.slice(2).join(' '));",
      [
        "defaults:",
        "  mode: execute",
        "  source: test",
        "  max_turns: 2",
        "  preset: default",
        "presets:",
        "  default:",
        "    skills: []",
        "    toolsets: []",
        "policy:",
        "  yolo: true",
        "  require_approval_for: []",
      ].join("\n"),
    );
    await withMcpClient(configPath, async (client) => {
      const submitted = JSON.parse(
        toolText(await client.callTool({ name: "hermes_submit", arguments: { prompt: "execute safely", mode: "execute" } })),
      ) as { id: string };
      let result: { status: string; output?: { stdout: string } } | undefined;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        result = JSON.parse(
          toolText(await client.callTool({ name: "hermes_result", arguments: { jobId: submitted.id } })),
        ) as { status: string; output?: { stdout: string } };
        if (result.status === "succeeded") break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(result?.status).toBe("succeeded");
      expect(result?.output?.stdout).not.toContain("--yolo");
      expect(result?.output?.stdout).toContain("YOLO: disabled");
    });
  }, 15_000);

  it("prepares and approves an unchanged action without logging the prompt", async () => {
    const privatePrompt = "send the private external message";
    const configPath = writeFakeHermesConfig("console.log('prepared or executed');");
    let confirmationMessage = "";
    await withMcpClient(configPath, async (client) => {
      const prepared = JSON.parse(
        toolText(await client.callTool({ name: "hermes_prepare", arguments: { prompt: privatePrompt } })),
      ) as { id: string; status: string; preview: { action: string; effectiveMode: string; promptFingerprint: string } };
      expect(prepared.status).toBe("awaiting_approval");
      expect(prepared.preview.action).toBe(privatePrompt);
      expect(prepared.preview.effectiveMode).toBe("request-approval");
      expect(prepared.preview.promptFingerprint).toHaveLength(64);

      const approved = JSON.parse(
        toolText(await client.callTool({ name: "hermes_approve", arguments: { approvalId: prepared.id } })),
      ) as { job: { id: string } };
      expect(approved.job.id).toBeTruthy();
      const audit = readFileSync(join(dirname(configPath), "audit.jsonl"), "utf8");
      expect(audit).not.toContain(privatePrompt);
      expect(audit).toContain('"phase":"approved"');
    }, {
      elicitation: (params) => {
        confirmationMessage = params.message;
        return { action: "accept", content: { confirm: true } };
      },
    });
    expect(confirmationMessage).toContain(privatePrompt);
    expect(confirmationMessage).toContain("Only the human operator may confirm it");
    expect(confirmationMessage).toContain('"effectiveMode": "execute"');
  }, 15_000);

  it("bounds and reports synchronous Hermes output", async () => {
    const configPath = writeFakeHermesConfig("process.stdout.write('x'.repeat(300_000));");
    await withMcpClient(configPath, async (client) => {
      const text = toolText(await client.callTool({
        name: "hermes_run",
        arguments: { prompt: "produce a large plan", mode: "plan" },
      }));
      expect(Buffer.byteLength(text, "utf8")).toBeLessThan(300_000);
      expect(text).toContain("output truncated at 262144 bytes");
    });
  }, 15_000);
});
