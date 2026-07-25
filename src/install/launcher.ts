import type { McpLauncher } from "./mcp-service.js";

/** Windows MCP clients need Node plus the CLI script; Unix can execute the shebang-enabled script directly. */
export function bridgeMcpLauncher(
  scriptPath: string,
  platform: NodeJS.Platform = process.platform,
  nodePath: string = process.execPath,
): McpLauncher {
  return platform === "win32"
    ? { command: nodePath, args: [scriptPath, "mcp"] }
    : { command: scriptPath, args: ["mcp"] };
}
