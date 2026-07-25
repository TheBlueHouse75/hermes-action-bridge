import { cpSync, createWriteStream, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yazl from "yazl";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const extensionRoot = join(repositoryRoot, "extensions", "hermes-action");
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(extensionRoot, "manifest.json"), "utf8"));
const packageName = String(packageJson.name);
const packageVersion = String(packageJson.version);

if (manifest.name !== packageName || manifest.version !== packageVersion) {
  throw new Error(
    `MCPB manifest identity (${manifest.name}@${manifest.version}) must match package.json (${packageName}@${packageVersion}).`,
  );
}

const outputDirectory = join(repositoryRoot, "release");
const outputPath = join(outputDirectory, `${packageName}-${packageVersion}.mcpb`);
const stagingDirectory = mkdtempSync(join(tmpdir(), "hermes-action-mcpb-"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const archiveMtime = new Date("1980-01-01T00:00:00.000Z");
// Claude Desktop launches this entry point with Node; bundled dependencies are loaded as modules.
const executableArchiveFiles = new Set(["dist/cli.js"]);

function listArchiveFiles(directory, relativePath = "") {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryRelativePath = relativePath ? posix.join(relativePath, entry.name) : entry.name;
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        return listArchiveFiles(entryPath, entryRelativePath);
      }

      return entry.isFile() ? [entryRelativePath] : [];
    })
    .sort();
}

function archiveMode(archiveFile) {
  return executableArchiveFiles.has(archiveFile) ? 0o100755 : 0o100644;
}

function createArchive(archivePath, sourceDirectory) {
  return new Promise((resolveArchive, rejectArchive) => {
    const archive = new yazl.ZipFile();
    const output = createWriteStream(archivePath);

    archive.outputStream.on("error", rejectArchive);
    output.on("error", rejectArchive);
    output.on("close", resolveArchive);

    for (const archiveFile of listArchiveFiles(sourceDirectory)) {
      archive.addFile(join(sourceDirectory, archiveFile), archiveFile, {
        mode: archiveMode(archiveFile),
        mtime: archiveMtime,
      });
    }

    archive.outputStream.pipe(output);
    archive.end();
  });
}

async function discoverManifestTools() {
  const [{ defaultConfig }, { listBridgeTools }] = await Promise.all([
    import(new URL("../dist/config.js", import.meta.url)),
    import(new URL("../dist/mcp-catalog.js", import.meta.url)),
  ]);
  const tools = await listBridgeTools(defaultConfig);
  return tools
    .map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

try {
  execFileSync(npmCommand, ["run", "build"], { cwd: repositoryRoot, stdio: "inherit" });

  const manifestWithTools = { ...manifest, tools: await discoverManifestTools() };
  writeFileSync(join(stagingDirectory, "manifest.json"), `${JSON.stringify(manifestWithTools, null, 2)}\n`);
  cpSync(join(extensionRoot, "README.md"), join(stagingDirectory, "README.md"));
  cpSync(join(extensionRoot, "icon.png"), join(stagingDirectory, "icon.png"));
  cpSync(join(repositoryRoot, "package.json"), join(stagingDirectory, "package.json"));
  cpSync(join(repositoryRoot, "package-lock.json"), join(stagingDirectory, "package-lock.json"));
  cpSync(join(repositoryRoot, "dist"), join(stagingDirectory, "dist"), { recursive: true });

  execFileSync(npmCommand, ["ci", "--omit=dev", "--ignore-scripts", "--audit=false", "--fund=false"], {
    cwd: stagingDirectory,
    stdio: "inherit",
  });

  mkdirSync(outputDirectory, { recursive: true });
  rmSync(outputPath, { force: true });

  await createArchive(outputPath, stagingDirectory);

  if (!existsSync(outputPath)) {
    throw new Error(`MCPB archive was not created: ${outputPath}`);
  }

  process.stdout.write(`${basename(outputPath)}\n`);
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
