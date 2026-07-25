import { describe, expect, it } from "vitest";
import { inspectMcp, installMcp, uninstallMcp, type McpCommandRunner } from "../src/install/mcp-service.js";
import { bridgeMcpLauncher } from "../src/install/launcher.js";

interface Invocation {
  command: string;
  args: string[];
}

const launcher = { command: "/opt/bin/hermes-action", args: ["mcp"] };

function fakeRunner(initial: Partial<Record<"codex" | "claude", "absent" | "current" | "conflict" | "unavailable">>): {
  runner: McpCommandRunner;
  calls: Invocation[];
} {
  const calls: Invocation[] = [];
  const states = { codex: initial.codex ?? "absent", claude: initial.claude ?? "absent" };
  const runner: McpCommandRunner = (command, args) => {
    calls.push({ command, args });
    const state = states[command as "codex" | "claude"];
    if (state === "unavailable") return { status: null, stdout: "", stderr: "", error: { code: "ENOENT", message: "not found" } };
    if (args[1] === "get") {
      if (state === "absent") return { status: 1, stdout: "", stderr: 'No MCP server named "hermes-action".' };
      const commandPath = state === "current" ? "/opt/bin/hermes-action" : "/custom/hermes-action";
      const output = command === "claude"
        ? `Scope: User config\nStatus: ✔ Connected\nType: stdio\nCommand: ${commandPath}\nArgs: mcp`
        : `transport: stdio\ncommand: ${commandPath}\nargs: mcp`;
      return { status: 0, stdout: output, stderr: "" };
    }
    if (args.includes("add")) {
      states[command as "codex" | "claude"] = "current";
      return { status: 0, stdout: "added", stderr: "" };
    }
    if (args.includes("remove")) {
      states[command as "codex" | "claude"] = "absent";
      return { status: 0, stdout: "removed", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

describe("MCP service", () => {
  it("installs fresh global registrations for both agents with an absolute bridge path", () => {
    const { runner, calls } = fakeRunner({});
    const result = installMcp("all", { launcher, dryRun: false, runner });

    expect(result.every((item) => item.ok)).toBe(true);
    expect(result.map((item) => item.change.action)).toEqual(["created", "created"]);
    expect(calls).toContainEqual({ command: "codex", args: ["mcp", "add", "hermes-action", "--", "/opt/bin/hermes-action", "mcp"] });
    expect(calls).toContainEqual({ command: "claude", args: ["mcp", "add", "--scope", "user", "--transport", "stdio", "hermes-action", "--", "/opt/bin/hermes-action", "mcp"] });
  });

  it("is idempotent when both registrations already match", () => {
    const { runner, calls } = fakeRunner({ codex: "current", claude: "current" });
    const result = installMcp("all", { launcher, dryRun: false, runner });

    expect(result.map((item) => item.change.action)).toEqual(["unchanged", "unchanged"]);
    expect(calls.some((call) => call.args.includes("add"))).toBe(false);
  });

  it("refuses a conflicting registration without replacing it", () => {
    const { runner, calls } = fakeRunner({ codex: "conflict" });
    const [result] = installMcp("codex", { launcher, dryRun: false, runner });

    expect(result?.ok).toBe(false);
    expect(result?.change).toMatchObject({ action: "refused", reason: expect.stringContaining("differs") });
    expect(calls.some((call) => call.args.includes("add"))).toBe(false);
  });

  it("reports planned work in dry-run without adding a registration", () => {
    const { runner, calls } = fakeRunner({ codex: "absent" });
    const [result] = installMcp("codex", { launcher, dryRun: true, runner });

    expect(result?.change.action).toBe("created");
    expect(result?.dryRun).toBe(true);
    expect(calls.some((call) => call.args.includes("add"))).toBe(false);
  });

  it("rolls back a registration created earlier in the same failed install", () => {
    let codexInstalled = false;
    const calls: Invocation[] = [];
    const runner: McpCommandRunner = (command, args) => {
      calls.push({ command, args });
      if (args[1] === "get") {
        if (command === "codex" && codexInstalled) {
          return { status: 0, stdout: "transport: stdio\ncommand: /opt/bin/hermes-action\nargs: mcp", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: 'No MCP server named "hermes-action".' };
      }
      if (command === "codex" && args.includes("add")) {
        codexInstalled = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "claude" && args.includes("add")) {
        return { status: 1, stdout: "", stderr: "permission denied" };
      }
      if (command === "codex" && args.includes("remove")) {
        codexInstalled = false;
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 2, stdout: "", stderr: "unexpected command" };
    };

    const result = installMcp("all", { launcher, dryRun: false, runner });

    expect(result.every((entry) => !entry.ok)).toBe(true);
    expect(codexInstalled).toBe(false);
    expect(calls).toContainEqual({ command: "codex", args: ["mcp", "remove", "hermes-action"] });
  });

  it("removes a newly added registration when readback verification fails", () => {
    let phase: "absent" | "added" | "removed" = "absent";
    const calls: Invocation[] = [];
    const runner: McpCommandRunner = (command, args) => {
      calls.push({ command, args });
      if (args[1] === "get") {
        if (phase === "absent" || phase === "removed") {
          return { status: 1, stdout: "", stderr: 'No MCP server named "hermes-action".' };
        }
        return {
          status: 0,
          stdout: "transport: stdio\ncommand: /opt/bin/hermes-action\nargs: mcp --unexpected",
          stderr: "",
        };
      }
      if (args.includes("add")) {
        phase = "added";
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args.includes("remove")) {
        phase = "removed";
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 2, stdout: "", stderr: "unexpected command" };
    };

    const [result] = installMcp("codex", { launcher, dryRun: false, runner });

    expect(result?.ok).toBe(false);
    expect(result?.change.reason).toContain("rolled back");
    expect(phase).toBe("removed");
    expect(calls).toContainEqual({ command: "codex", args: ["mcp", "remove", "hermes-action"] });
  });

  it("removes only an existing Hermes registration", () => {
    const { runner, calls } = fakeRunner({ claude: "current" });
    const [result] = uninstallMcp("claude-code", { launcher, dryRun: false, runner });

    expect(result?.change.action).toBe("removed");
    expect(calls).toContainEqual({ command: "claude", args: ["mcp", "remove", "--scope", "user", "hermes-action"] });
  });

  it("does not remove a conflicting registration", () => {
    const { runner, calls } = fakeRunner({ claude: "conflict" });
    const [result] = uninstallMcp("claude-code", { launcher, dryRun: false, runner });

    expect(result?.change.action).toBe("refused");
    expect(calls.some((call) => call.args.includes("remove"))).toBe(false);
  });

  it("fails explicitly when the requested agent CLI is unavailable", () => {
    const { runner } = fakeRunner({ codex: "unavailable" });
    const [result] = installMcp("codex", { launcher, dryRun: false, runner });

    expect(result?.ok).toBe(false);
    expect(result?.change).toMatchObject({ action: "refused", reason: expect.stringContaining("not available") });
  });

  it("rejects relative bridge paths before invoking an agent CLI", () => {
    const { runner, calls } = fakeRunner({});
    const [result] = installMcp("codex", { launcher: { command: "hermes-action", args: ["mcp"] }, dryRun: false, runner });

    expect(result?.change.action).toBe("refused");
    expect(calls).toEqual([]);
  });

  it("does not accept a longer executable path that merely contains the expected path", () => {
    const registration = inspectMcp("codex", launcher, () => ({
      status: 0,
      stdout: "transport: stdio\ncommand: /opt/bin/hermes-action-old\nargs: mcp",
      stderr: "",
    }));

    expect(registration.state).toBe("conflict");
  });

  it("does not accept a project-scoped Claude registration as the global install", () => {
    const registration = inspectMcp("claude-code", launcher, () => ({
      status: 0,
      stdout: "Scope: Project config (shared via .mcp.json)\nCommand: /opt/bin/hermes-action\nArgs: mcp",
      stderr: "",
    }));

    expect(registration.state).toBe("conflict");
  });

  it("does not accept a non-stdio Claude registration as the global install", () => {
    const registration = inspectMcp("claude-code", launcher, () => ({
      status: 0,
      stdout: "Scope: User config\nType: http\nCommand: /opt/bin/hermes-action\nArgs: mcp",
      stderr: "",
    }));

    expect(registration.state).toBe("conflict");
  });

  it("does not accept a matching Claude registration that failed to connect", () => {
    const registration = inspectMcp("claude-code", launcher, () => ({
      status: 0,
      stdout: "Scope: User config\nStatus: ✘ Failed to connect\nType: stdio\nCommand: /opt/bin/hermes-action\nArgs: mcp",
      stderr: "",
    }));

    expect(registration.state).toBe("conflict");
  });

  it("does not treat an arbitrary get failure as an absent registration", () => {
    const registration = inspectMcp("claude-code", launcher, () => ({
      status: 1,
      stdout: "",
      stderr: "Configuration file is not valid JSON",
    }));

    expect(registration).toMatchObject({ state: "error", detail: expect.stringContaining("not valid JSON") });
  });

  it("requires the exact launcher argument vector", () => {
    const registration = inspectMcp("codex", launcher, () => ({
      status: 0,
      stdout: "transport: stdio\ncommand: /opt/bin/hermes-action\nargs: mcp --config /tmp/custom.yml",
      stderr: "",
    }));

    expect(registration.state).toBe("conflict");
  });

  it("uses Node to launch the CLI script on Windows", () => {
    expect(bridgeMcpLauncher("/opt/hermes/dist/cli.js", "win32", "/usr/bin/node")).toEqual({
      command: "/usr/bin/node",
      args: ["/opt/hermes/dist/cli.js", "mcp"],
    });
  });
});
