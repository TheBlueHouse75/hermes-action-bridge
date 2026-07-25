import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as T;
}
