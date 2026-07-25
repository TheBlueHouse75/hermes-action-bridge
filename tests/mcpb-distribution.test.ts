import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { readJson } from "./helpers/json.js";
import { withMcpClient } from "./helpers/mcp.js";

type McpbManifest = {
  manifest_version: string;
  name: string;
  version: string;
  description: string;
  author: { name: string };
  icon: string;
  server: {
    type: string;
    entry_point: string;
    mcp_config: { command: string; args: string[] };
  };
};

const repositoryRoot = process.cwd();
const packageJson = readJson<{ name: string; version: string }>("package.json");
const manifest = readJson<McpbManifest>("extensions/hermes-action/manifest.json");
const artifactPath = join(repositoryRoot, "release", `${packageJson.name}-${packageJson.version}.mcpb`);
const rootConfigurationFiles = new Set(["manifest.json", "package.json", "package-lock.json"]);
const textExtensions = new Set([".js", ".json", ".yaml", ".yml", ".md"]);

function openArchive(archive: string): Promise<yauzl.ZipFile> {
  return new Promise((resolveArchive, rejectArchive) => {
    yauzl.open(archive, { autoClose: false, lazyEntries: true }, (error, zipFile) => {
      if (error) rejectArchive(error);
      else if (zipFile) resolveArchive(zipFile);
      else rejectArchive(new Error(`Could not open archive: ${archive}`));
    });
  });
}

async function withArchive<T>(archive: string, operation: (zipFile: yauzl.ZipFile) => Promise<T>): Promise<T> {
  const zipFile = await openArchive(archive);
  try {
    return await operation(zipFile);
  } finally {
    zipFile.close();
  }
}

function archiveEntries(archive: string): Promise<string[]> {
  return withArchive(
    archive,
    (zipFile) =>
      new Promise((resolveEntries, rejectEntries) => {
        const entries: string[] = [];
        zipFile.on("error", rejectEntries);
        zipFile.on("entry", (entry) => {
          entries.push(entry.fileName);
          zipFile.readEntry();
        });
        zipFile.on("end", () => resolveEntries(entries));
        zipFile.readEntry();
      }),
  );
}

function archiveModes(archive: string): Promise<Map<string, number>> {
  return withArchive(
    archive,
    (zipFile) =>
      new Promise((resolveModes, rejectModes) => {
        const modes = new Map<string, number>();
        zipFile.on("error", rejectModes);
        zipFile.on("entry", (entry) => {
          modes.set(entry.fileName, entry.externalFileAttributes >>> 16);
          zipFile.readEntry();
        });
        zipFile.on("end", () => resolveModes(modes));
        zipFile.readEntry();
      }),
  );
}

function archiveText(archive: string, path: string): Promise<string> {
  return withArchive(
    archive,
    (zipFile) =>
      new Promise((resolveText, rejectText) => {
        zipFile.on("error", rejectText);
        zipFile.on("entry", (entry) => {
          if (entry.fileName !== path) {
            zipFile.readEntry();
            return;
          }

          zipFile.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              rejectText(error ?? new Error(`Could not read ${path} from ${archive}`));
              return;
            }

            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("error", rejectText);
            stream.on("end", () => resolveText(Buffer.concat(chunks).toString("utf8")));
          });
        });
        zipFile.on("end", () => rejectText(new Error(`Archive entry not found: ${path}`)));
        zipFile.readEntry();
      }),
  );
}

function extractArchive(archive: string, destination: string): Promise<void> {
  return withArchive(
    archive,
    (zipFile) =>
      new Promise((resolveExtraction, rejectExtraction) => {
        const destinationRoot = resolve(destination);
        zipFile.on("error", rejectExtraction);
        zipFile.on("entry", (entry) => {
          const outputPath = resolve(destination, entry.fileName);
          const relativeOutputPath = relative(destinationRoot, outputPath);
          if (relativeOutputPath.startsWith("..") || isAbsolute(relativeOutputPath)) {
            rejectExtraction(new Error(`Archive entry escapes extraction root: ${entry.fileName}`));
            return;
          }
          if (entry.fileName.endsWith("/")) {
            mkdirSync(outputPath, { recursive: true });
            zipFile.readEntry();
            return;
          }

          mkdirSync(dirname(outputPath), { recursive: true });
          zipFile.openReadStream(entry, (error, stream) => {
            if (error || !stream) {
              rejectExtraction(error ?? new Error(`Could not extract ${entry.fileName}`));
              return;
            }
            const output = createWriteStream(outputPath);
            stream.on("error", rejectExtraction);
            output.on("error", rejectExtraction);
            output.on("close", () => zipFile.readEntry());
            stream.pipe(output);
          });
        });
        zipFile.on("end", resolveExtraction);
        zipFile.readEntry();
      }),
  );
}

function isRuntimeOrConfigurationText(entry: string): boolean {
  return rootConfigurationFiles.has(entry) || (entry.startsWith("dist/") && textExtensions.has(extname(entry)));
}

function buildMcpb(): void {
  execFileSync(process.execPath, ["scripts/build-mcpb.mjs"], { cwd: repositoryRoot });
}

function pngDimensions(path: string): { width: number; height: number } {
  const image = readFileSync(path);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(image.subarray(0, pngSignature.length)).toEqual(pngSignature);
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

describe("MCPB distribution", () => {
  beforeAll(buildMcpb);

  it("keeps the MCPB manifest synchronized with the published package and defines the autonomous Node launcher", () => {
    expect(manifest).toMatchObject({
      manifest_version: "0.3",
      name: packageJson.name,
      version: packageJson.version,
    });
    expect(manifest.description).not.toHaveLength(0);
    expect(manifest.author.name).not.toHaveLength(0);
    expect(existsSync(join(repositoryRoot, "extensions", "hermes-action", manifest.icon))).toBe(true);
    expect(manifest.server).toMatchObject({
      type: "node",
      entry_point: "dist/cli.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/dist/cli.js", "mcp"],
      },
    });
  });

  it("ships one high-resolution icon across the public, Codex, and MCPB surfaces", () => {
    const iconPaths = [
      join(repositoryRoot, "assets", "logo.png"),
      join(repositoryRoot, "plugins", "hermes-action", "assets", "app-icon.png"),
      join(repositoryRoot, "extensions", "hermes-action", manifest.icon),
    ];
    const iconHashes = iconPaths.map((path) => createHash("sha256").update(readFileSync(path)).digest("hex"));

    expect(new Set(iconHashes).size).toBe(1);
    expect(pngDimensions(iconPaths[0])).toEqual({ width: 512, height: 512 });
  });

  it("builds a reproducible, inspectable bundle without secrets or machine-specific paths", async () => {
    expect(existsSync(artifactPath)).toBe(true);

    const firstArchiveHash = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
    buildMcpb();
    const secondArchiveHash = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
    expect(secondArchiveHash).toBe(firstArchiveHash);

    const entries = await archiveEntries(artifactPath);
    expect(entries).toContain("dist/cli.js");
    expect(entries).toContain("node_modules/@modelcontextprotocol/sdk/package.json");
    expect(entries).toContain("package.json");
    expect(entries).toContain(manifest.icon);
    expect(entries).toContain(manifest.server.entry_point);

    const modes = await archiveModes(artifactPath);
    expect(modes.get(manifest.server.entry_point)).toBe(0o100755);
    expect([...modes.entries()].filter(([entry]) => entry !== manifest.server.entry_point).every(([, mode]) => mode === 0o100644)).toBe(true);

    const textEntries = entries.filter(isRuntimeOrConfigurationText);
    expect(textEntries).toContain(manifest.server.entry_point);
    const bundleContent = (await Promise.all(textEntries.map((entry) => archiveText(artifactPath, entry)))).join("\n");
    const [manifestText, runtimeText] = await Promise.all([
      archiveText(artifactPath, "manifest.json"),
      archiveText(artifactPath, manifest.server.entry_point),
    ]);

    expect(manifestText).not.toContain("npx");
    expect(runtimeText).not.toContain("npx");
    expect(bundleContent).not.toMatch(/(?:api[_-]?key|token|secret)\s*[:=]\s*["'][^"']+/i);
    expect(bundleContent).not.toContain("/Users/");
    expect(bundleContent).not.toMatch(/[A-Z]:\\Users\\/i);
  });

  it("starts the bundled runtime and completes an MCP tools handshake", async () => {
    const extractionRoot = mkdtempSync(join(tmpdir(), "hermes-action-mcpb-test-"));
    const configPath = join(extractionRoot, "config.yaml");
    writeFileSync(configPath, "presets:\n  default:\n    skills: []\n    toolsets: []\n");
    await extractArchive(artifactPath, extractionRoot);

    try {
      await withMcpClient(
        configPath,
        async (client) => {
          const result = await client.listTools();
          expect(result.tools.map((tool) => tool.name)).toContain("hermes_status");
        },
        {
          cliPath: join(extractionRoot, manifest.server.entry_point),
          cwd: extractionRoot,
        },
      );
    } finally {
      rmSync(extractionRoot, { recursive: true, force: true });
    }
  });
});
