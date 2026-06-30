import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ContextDocument } from "./types.js";

/** Hard per-file safety cap, independent of the aggregate budget. */
const maxFileBytes = 250_000;

/**
 * Read context files, enforcing a per-file cap and an aggregate budget so the
 * total context is bounded and fails with a clear, actionable message. The
 * default budget leaves headroom under ARG_MAX for the rest of the envelope
 * (header + user prompt); the precise envelope-size check lives in the adapter.
 */
export function readContextFiles(paths: string[], maxTotalBytes: number, cwd = process.cwd()): ContextDocument[] {
  const documents: ContextDocument[] = [];
  let total = 0;
  for (const inputPath of paths) {
    const path = resolve(cwd, inputPath);
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error(`Context path is not a file: ${inputPath}`);
    if (stat.size > maxFileBytes) {
      throw new Error(`Context file is too large (${stat.size} bytes, max ${maxFileBytes} per file): ${inputPath}`);
    }
    total += stat.size;
    if (total > maxTotalBytes) {
      throw new Error(
        `Context total ${total} bytes exceeds the limit of ${maxTotalBytes}. Split your handoff or raise runtime.max_context_bytes.`,
      );
    }
    documents.push({ path, content: readFileSync(path, "utf8") });
  }
  return documents;
}
