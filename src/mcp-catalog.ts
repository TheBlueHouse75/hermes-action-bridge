import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createBridgeMcpServer, createBridgeRuntime } from "./mcp-server.js";
import type { BridgeConfig } from "./types.js";

/** Return the current server's public tool catalog through the MCP protocol. */
export async function listBridgeTools(config: BridgeConfig): Promise<Tool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const runtime = createBridgeRuntime(config);
  const server = createBridgeMcpServer(config, { runtime });
  const client = new Client({ name: "hermes-action-catalog", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return (await client.listTools()).tools;
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await runtime.dispose().catch(() => undefined);
  }
}
