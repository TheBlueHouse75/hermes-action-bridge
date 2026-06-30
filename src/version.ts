import { readFileSync } from "node:fs";

interface PackageJson {
  version?: string;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as PackageJson;
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const version = readVersion();
