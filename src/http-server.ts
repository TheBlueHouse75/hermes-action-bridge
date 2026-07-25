import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createBridgeMcpServer, createBridgeRuntime } from "./mcp-server.js";
import type { BridgeConfig } from "./types.js";
import { positiveInteger } from "./validation.js";

const defaultMaxBodyBytes = 1024 * 1024;
const defaultMaxSessions = 64;
const defaultSessionTtlMs = 30 * 60 * 1000;
const tokenNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface BridgeHttpOptions {
  config: BridgeConfig;
  listen: string;
  port: number;
  allowTailnet: boolean;
  tokenEnv?: string | undefined;
  maxBodyBytes?: number | undefined;
  maxSessions?: number | undefined;
  sessionTtlMs?: number | undefined;
}

export interface BridgeHttpHandle {
  host: string;
  port: number;
  close(): Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivityAt: number;
  activeRequests: number;
}

export async function startBridgeHttpServer(options: BridgeHttpOptions): Promise<BridgeHttpHandle> {
  validateNetworkOptions(options);
  const token = readBearerToken(options.tokenEnv);
  const tailnetMode = !isLoopback(options.listen);
  if (tailnetMode && !token) throw new Error("A bearer token is required for direct tailnet listening.");
  const principalId = token ? `token:${createHash("sha256").update(token).digest("hex").slice(0, 16)}` : "loopback";
  const maxBodyBytes = positiveInteger(options.maxBodyBytes, defaultMaxBodyBytes, "maxBodyBytes");
  const maxSessions = positiveInteger(options.maxSessions, defaultMaxSessions, "maxSessions");
  const sessionTtlMs = positiveInteger(options.sessionTtlMs, defaultSessionTtlMs, "sessionTtlMs");
  const sessions = new Map<string, Session>();
  const runtime = createBridgeRuntime(options.config);
  const context: RequestContext = {
    options,
    token,
    tailnetMode,
    principalId,
    maxBodyBytes,
    maxSessions,
    sessionTtlMs,
    sessions,
    pendingInitializations: 0,
    runtime,
  };
  const server = createServer((request, response) => void handleRequest(request, response, context));
  const sessionCleanupTimer = setInterval(() => expireSessions(context), Math.min(sessionTtlMs, 60_000));
  sessionCleanupTimer.unref();

  await listen(server, options.listen, options.port);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine the HTTP listener address.");

  return {
    host: options.listen,
    port: address.port,
    close: async () => {
      clearInterval(sessionCleanupTimer);
      try {
        await Promise.allSettled([...sessions.values()].map(closeSession));
        sessions.clear();
        await closeServer(server);
      } finally {
        await runtime.dispose();
      }
    },
  };
}

interface RequestContext {
  options: BridgeHttpOptions;
  token: string | undefined;
  tailnetMode: boolean;
  principalId: string;
  maxBodyBytes: number;
  maxSessions: number;
  sessionTtlMs: number;
  sessions: Map<string, Session>;
  pendingInitializations: number;
  runtime: ReturnType<typeof createBridgeRuntime>;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> {
  try {
    if (request.url !== "/mcp") return sendStatus(response, 404, "Not Found");
    const host = requestHost(request);
    if (!host || !validHost(host, context.options.listen)) return sendStatus(response, 421, "Misdirected Request");
    if (context.tailnetMode && !isTailscaleIpv4(normalizeRemoteAddress(request.socket.remoteAddress))) {
      return sendStatus(response, 403, "Forbidden");
    }
    if (isTailscaleServeHost(host) && !context.token) {
      response.setHeader("WWW-Authenticate", "Bearer");
      return sendStatus(response, 401, "Tailscale Serve forwarding requires bearer authentication");
    }
    if (context.token && !validBearer(request.headers.authorization, context.token)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      return sendStatus(response, 401, "Unauthorized");
    }

    const sessionId = singleHeader(request.headers["mcp-session-id"]);
    if (request.method === "POST") {
      const body = await readJsonBody(request, context.maxBodyBytes);
      if (sessionId) {
        const session = context.sessions.get(sessionId);
        if (!session) return sendMcpError(response, 404, "Unknown MCP session");
        await handleSessionRequest(session, () => session.transport.handleRequest(request, response, body));
        return;
      }
      if (!isInitializeRequest(body)) return sendMcpError(response, 400, "MCP initialization required");
      expireSessions(context);
      if (context.sessions.size + context.pendingInitializations >= context.maxSessions) {
        return sendMcpError(response, 503, "MCP session limit reached");
      }
      context.pendingInitializations += 1;
      try {
        await initializeSession(request, response, body, context);
      } finally {
        context.pendingInitializations -= 1;
      }
      return;
    }

    if (request.method === "GET" || request.method === "DELETE") {
      if (!sessionId) return sendMcpError(response, 400, "MCP session ID required");
      const session = context.sessions.get(sessionId);
      if (!session) return sendMcpError(response, 404, "Unknown MCP session");
      await handleSessionRequest(session, () => session.transport.handleRequest(request, response));
      return;
    }

    response.setHeader("Allow", "GET, POST, DELETE");
    sendStatus(response, 405, "Method Not Allowed");
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    if (!response.headersSent) sendMcpError(response, status, status === 500 ? "Internal server error" : errorMessage(error));
    else response.end();
  }
}

async function initializeSession(
  request: IncomingMessage,
  response: ServerResponse,
  body: unknown,
  context: RequestContext,
): Promise<void> {
  const server = createBridgeMcpServer(context.options.config, {
    transport: "http",
    principalId: context.principalId,
    runtime: context.runtime,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessioninitialized: (sessionId) => {
      context.sessions.set(sessionId, { transport, server, lastActivityAt: Date.now(), activeRequests: 1 });
    },
  });
  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId) context.sessions.delete(sessionId);
  };
  // SDK 1.x exposes `onclose` as an accessor returning `undefined`, which is
  // structurally narrower than `Transport` under exactOptionalPropertyTypes.
  await server.connect(transport as unknown as Transport);
  try {
    await transport.handleRequest(request, response, body);
  } finally {
    const sessionId = transport.sessionId;
    const session = sessionId ? context.sessions.get(sessionId) : undefined;
    if (session) {
      session.activeRequests = Math.max(0, session.activeRequests - 1);
      session.lastActivityAt = Date.now();
    }
  }
}

function expireSessions(context: RequestContext): void {
  const cutoff = Date.now() - context.sessionTtlMs;
  for (const [sessionId, session] of context.sessions) {
    if (session.activeRequests > 0 || session.lastActivityAt > cutoff) continue;
    context.sessions.delete(sessionId);
    void closeSession(session).catch(() => undefined);
  }
}

async function handleSessionRequest(session: Session, handle: () => Promise<void>): Promise<void> {
  session.activeRequests += 1;
  session.lastActivityAt = Date.now();
  try {
    await handle();
  } finally {
    session.activeRequests = Math.max(0, session.activeRequests - 1);
    session.lastActivityAt = Date.now();
  }
}

async function closeSession(session: Session): Promise<void> {
  try {
    await session.transport.close();
  } finally {
    await session.server.close();
  }
}

function validateNetworkOptions(options: BridgeHttpOptions): void {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("port must be an integer between 0 and 65535");
  }
  if (isLoopback(options.listen)) return;
  if (!options.allowTailnet) throw new Error("Non-loopback listening requires --allow-tailnet.");
  if (!isTailscaleIpv4(options.listen)) {
    throw new Error("Direct remote listening is restricted to a Tailscale IPv4 address in 100.64.0.0/10.");
  }
  if (!options.tokenEnv) throw new Error("Direct tailnet listening requires --token-env.");
}

function readBearerToken(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (!tokenNamePattern.test(name)) throw new Error(`Invalid token environment variable name: ${name}`);
  const token = process.env[name];
  if (!token) throw new Error(`Bearer token environment variable is unset: ${name}`);
  if (Buffer.byteLength(token, "utf8") < 32) throw new Error("Bearer token must contain at least 32 bytes.");
  return token;
}

function validBearer(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const target = Buffer.from(expected, "utf8");
  return supplied.length === target.length && timingSafeEqual(supplied, target);
}

function requestHost(request: IncomingMessage): string | undefined {
  const header = singleHeader(request.headers.host);
  if (!header) return undefined;
  if (header.startsWith("[")) {
    const closingBracket = header.indexOf("]");
    return closingBracket > 1 ? header.slice(1, closingBracket) : undefined;
  }
  return header.split(":")[0] || undefined;
}

function validHost(host: string, listenAddress: string): boolean {
  if (isLoopback(listenAddress)) return host === "localhost" || isLoopback(host) || isTailscaleServeHost(host);
  return host === listenAddress;
}

function isTailscaleServeHost(host: string): boolean {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/i.test(host);
}

function isLoopback(address: string): boolean {
  if (address === "localhost" || address === "::1") return true;
  const octets = parseIpv4(address);
  return octets?.[0] === 127;
}

export function isTailscaleIpv4(address: string | undefined): boolean {
  const octets = address ? parseIpv4(address) : undefined;
  if (!octets) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function parseIpv4(address: string): [number, number, number, number] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => Number(part));
  if (octets.some((part, index) => !Number.isInteger(part) || part < 0 || part > 255 || String(part) !== parts[index])) {
    return undefined;
  }
  return octets as [number, number, number, number];
}

function normalizeRemoteAddress(address: string | undefined): string | undefined {
  return address?.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new RequestError(413, "Request body too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RequestError(400, "Request body is not valid JSON");
  }
}

function sendStatus(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

function sendMcpError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
