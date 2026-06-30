import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ContextDocument } from "./types.js";

const maxContextBytes = 250_000;

export function readContextFiles(paths: string[], cwd = process.cwd()): ContextDocument[] {
  return paths.map((inputPath) => {
    const path = resolve(cwd, inputPath);
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error(`Context path is not a file: ${inputPath}`);
    if (stat.size > maxContextBytes) throw new Error(`Context file is too large (${stat.size} bytes, max ${maxContextBytes}): ${inputPath}`);
    return { path, content: readFileSync(path, "utf8") };
  });
}
