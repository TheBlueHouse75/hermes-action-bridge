import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
const defaultArchive = join(repositoryRoot, "release", `${packageJson.name}-${packageJson.version}.mcpb`);
const archivePath = resolve(process.argv[2] ?? defaultArchive);

const archive = await new Promise((resolveArchive, rejectArchive) => {
  yauzl.open(archivePath, { lazyEntries: true }, (error, zipFile) => {
    if (error) rejectArchive(error);
    else if (zipFile) resolveArchive(zipFile);
    else rejectArchive(new Error(`Could not open archive: ${archivePath}`));
  });
});

await new Promise((resolveEntries, rejectEntries) => {
  archive.on("error", rejectEntries);
  archive.on("entry", (entry) => {
    process.stdout.write(`${entry.fileName}\n`);
    archive.readEntry();
  });
  archive.on("end", resolveEntries);
  archive.readEntry();
});
