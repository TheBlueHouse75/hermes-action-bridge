import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, loadConfig } from "../src/config.js";
import { isTailscaleIpv4, startBridgeHttpServer, type BridgeHttpHandle } from "../src/http-server.js";
import { toolText, writeFakeHermesConfig } from "./helpers/mcp.js";

const handles: BridgeHttpHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  delete process.env.HAB_TEST_HTTP_TOKEN;
});

describe("HTTP MCP server", () => {
  it("serves a Streamable HTTP MCP handshake on loopback", async () => {
    const handle = await startBridgeHttpServer({
      config: defaultConfig,
      listen: "127.0.0.1",
      port: 0,
      allowTailnet: false,
    });
    handles.push(handle);
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`));
    const client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("hermes_capabilities");
    } finally {
      await client.close();
    }
  });

  it("refuses public and non-Tailscale listen addresses", async () => {
    await expect(
      startBridgeHttpServer({ config: defaultConfig, listen: "0.0.0.0", port: 8765, allowTailnet: false }),
    ).rejects.toThrow("allow-tailnet");
    await expect(
      startBridgeHttpServer({ config: defaultConfig, listen: "192.168.1.20", port: 8765, allowTailnet: true }),
    ).rejects.toThrow("Tailscale");
  });

  it("requires a sufficiently strong bearer token for direct tailnet listening", async () => {
    await expect(
      startBridgeHttpServer({
        config: defaultConfig,
        listen: "100.64.0.1",
        port: 8765,
        allowTailnet: true,
        tokenEnv: "HAB_TEST_HTTP_TOKEN",
      }),
    ).rejects.toThrow("unset");
    process.env.HAB_TEST_HTTP_TOKEN = "too-short";
    await expect(
      startBridgeHttpServer({
        config: defaultConfig,
        listen: "100.64.0.1",
        port: 8765,
        allowTailnet: true,
        tokenEnv: "HAB_TEST_HTTP_TOKEN",
      }),
    ).rejects.toThrow("32 bytes");
  });

  it("enforces bearer authentication when configured on loopback", async () => {
    process.env.HAB_TEST_HTTP_TOKEN = "a-secure-test-token-with-at-least-32-bytes";
    const handle = await startBridgeHttpServer({
      config: defaultConfig,
      listen: "127.0.0.1",
      port: 0,
      allowTailnet: false,
      tokenEnv: "HAB_TEST_HTTP_TOKEN",
    });
    handles.push(handle);

    const response = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it("requires authentication for a Tailscale Serve host forwarded to loopback", async () => {
    const handle = await startBridgeHttpServer({
      config: defaultConfig,
      listen: "127.0.0.1",
      port: 0,
      allowTailnet: false,
    });
    handles.push(handle);

    const response = await getWithHost(handle.port, "hermes-mini.example-tailnet.ts.net");
    expect(response.status).toBe(401);
    expect(response.wwwAuthenticate).toBe("Bearer");
  });

  it("accepts authenticated Tailscale Serve forwarding", async () => {
    process.env.HAB_TEST_HTTP_TOKEN = "a-secure-test-token-with-at-least-32-bytes";
    const handle = await startBridgeHttpServer({
      config: defaultConfig,
      listen: "127.0.0.1",
      port: 0,
      allowTailnet: false,
      tokenEnv: "HAB_TEST_HTTP_TOKEN",
    });
    handles.push(handle);

    const response = await getWithHost(
      handle.port,
      "hermes-mini.example-tailnet.ts.net",
      `Bearer ${process.env.HAB_TEST_HTTP_TOKEN}`,
    );
    expect(response.status).toBe(400);
    expect(response.body).toContain("MCP session ID required");
  });

  it("reserves session capacity while concurrent initializations are pending", async () => {
    const handle = await startBridgeHttpServer({
      config: defaultConfig,
      listen: "127.0.0.1",
      port: 0,
      allowTailnet: false,
      maxSessions: 1,
    });
    handles.push(handle);
    const url = `http://127.0.0.1:${handle.port}/mcp`;
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "concurrency-test", version: "1.0.0" },
      },
    };
    const request = () => fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(initialize),
    });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 503]);
  });

  it("expires abandoned sessions so they cannot exhaust capacity forever", async () => {
    const handle = await startBridgeHttpServer({
      config: defaultConfig,
      listen: "127.0.0.1",
      port: 0,
      allowTailnet: false,
      maxSessions: 1,
      sessionTtlMs: 20,
    });
    handles.push(handle);
    const url = `http://127.0.0.1:${handle.port}/mcp`;
    const request = () => fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "expiry-test", version: "1.0.0" },
        },
      }),
    });

    expect((await request()).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await request()).status).toBe(200);
  });

  it("does not expire a session while a long MCP request is active", async () => {
    const configPath = writeFakeHermesConfig("setTimeout(() => console.log('slow result'), 80);");
    const handle = await startBridgeHttpServer({
      config: loadConfig(process.cwd(), configPath),
      listen: "127.0.0.1",
      port: 0,
      allowTailnet: false,
      sessionTtlMs: 20,
    });
    handles.push(handle);
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`));
    const client = new Client({ name: "active-session-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const result = await client.callTool({
        name: "hermes_run",
        arguments: { prompt: "slow request", mode: "plan" },
      });
      expect(toolText(result)).toContain("slow result");
    } finally {
      await client.close();
    }
  });

  it("recognizes only the Tailscale CGNAT IPv4 range", () => {
    expect(isTailscaleIpv4("100.64.0.1")).toBe(true);
    expect(isTailscaleIpv4("100.127.255.254")).toBe(true);
    expect(isTailscaleIpv4("100.128.0.1")).toBe(false);
    expect(isTailscaleIpv4("127.0.0.1")).toBe(false);
  });
});

function getWithHost(
  port: number,
  host: string,
  authorization?: string,
): Promise<{ status: number; body: string; wwwAuthenticate: string | undefined }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host };
    if (authorization) headers.authorization = authorization;
    const request = httpRequest({ hostname: "127.0.0.1", port, path: "/mcp", headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          wwwAuthenticate: response.headers["www-authenticate"],
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}
