import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readContextFiles } from "../src/context.js";

function writeFile(dir: string, name: string, bytes: number): string {
  const path = join(dir, name);
  writeFileSync(path, "x".repeat(bytes));
  return path;
}

describe("readContextFiles", () => {
  it("reads files that fit within the aggregate budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-ctx-"));
    const a = writeFile(dir, "a.md", 100);
    const b = writeFile(dir, "b.md", 100);
    const docs = readContextFiles([a, b], 1_000);
    expect(docs).toHaveLength(2);
    expect(docs[0]?.content).toHaveLength(100);
  });

  it("throws a clear error when the aggregate budget is exceeded", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-ctx-"));
    const a = writeFile(dir, "a.md", 600);
    const b = writeFile(dir, "b.md", 600);
    expect(() => readContextFiles([a, b], 1_000)).toThrow(/Context total \d+ bytes exceeds the limit of 1000/);
  });

  it("enforces the per-file cap independently of the aggregate budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-ctx-"));
    const big = writeFile(dir, "big.md", 250_001);
    expect(() => readContextFiles([big], 10_000_000)).toThrow(/too large .* per file/);
  });

  it("rejects a path that is not a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-ctx-"));
    expect(() => readContextFiles([dir], 1_000)).toThrow(/not a file/);
  });
});
