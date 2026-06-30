import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyBundle, removeBundle, writeBundle, type ManagedBundle } from "../src/install/managed-file.js";

function bundle(dir: string, content = "SKILL v1\n"): ManagedBundle {
  return { dir, files: { "SKILL.md": content } };
}

function freshDir(): string {
  return join(mkdtempSync(join(tmpdir(), "hab-managed-")), "skill");
}

const write = { force: false, dryRun: false };

describe("managed-file bundle", () => {
  it("creates a bundle and is idempotent on re-write", () => {
    const dir = freshDir();
    const created = writeBundle(bundle(dir), write);
    expect(created[0]?.action).toBe("created");
    expect(existsSync(join(dir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".hermes-action-managed.json"))).toBe(true);
    expect(classifyBundle(bundle(dir))).toBe("current");
    expect(writeBundle(bundle(dir), write)[0]?.action).toBe("unchanged");
  });

  it("detects stale content and only updates with --force", () => {
    const dir = freshDir();
    writeBundle(bundle(dir, "SKILL v1\n"), write);
    expect(classifyBundle(bundle(dir, "SKILL v2\n"))).toBe("stale");
    expect(writeBundle(bundle(dir, "SKILL v2\n"), write)[0]?.action).toBe("refused");
    expect(writeBundle(bundle(dir, "SKILL v2\n"), { force: true, dryRun: false })[0]?.action).toBe("updated");
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("SKILL v2\n");
  });

  it("detects a hand-edited file as user-modified and refuses without --force", () => {
    const dir = freshDir();
    writeBundle(bundle(dir), write);
    writeFileSync(join(dir, "SKILL.md"), "hand edited\n");
    expect(classifyBundle(bundle(dir))).toBe("user-modified");
    expect(writeBundle(bundle(dir), write)[0]?.action).toBe("refused");
    expect(writeBundle(bundle(dir), { force: true, dryRun: false })[0]?.action).toBe("updated");
  });

  it("refuses a foreign directory even with --force", () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "not ours\n");
    expect(classifyBundle(bundle(dir))).toBe("foreign");
    expect(writeBundle(bundle(dir), { force: true, dryRun: false })[0]?.action).toBe("refused");
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("not ours\n");
  });

  it("writes every file in a multi-file bundle and cleans up dropped files on update", () => {
    const dir = freshDir();
    const created = writeBundle({ dir, files: { "SKILL.md": "a\n", "openai.yaml": "b\n" } }, write);
    expect(created.map((change) => change.action)).toEqual(["created", "created"]);
    expect(existsSync(join(dir, "openai.yaml"))).toBe(true);
    writeBundle({ dir, files: { "SKILL.md": "a2\n" } }, { force: true, dryRun: false });
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("a2\n");
    expect(existsSync(join(dir, "openai.yaml"))).toBe(false);
  });

  it("supports nested file names by creating parent directories", () => {
    const dir = freshDir();
    writeBundle({ dir, files: { "nested/file.txt": "x\n" } }, write);
    expect(readFileSync(join(dir, "nested", "file.txt"), "utf8")).toBe("x\n");
  });

  it("treats a corrupt lockfile as foreign and refuses to overwrite", () => {
    const dir = freshDir();
    writeBundle(bundle(dir), write);
    writeFileSync(join(dir, ".hermes-action-managed.json"), "{ not json");
    expect(classifyBundle(bundle(dir))).toBe("foreign");
    expect(writeBundle(bundle(dir), { force: true, dryRun: false })[0]?.action).toBe("refused");
  });

  it("dry-run reports the action without writing", () => {
    const dir = freshDir();
    const result = writeBundle(bundle(dir), { force: false, dryRun: true });
    expect(result[0]?.action).toBe("created");
    expect(existsSync(dir)).toBe(false);
  });

  it("removes a managed bundle and refuses to remove a modified or foreign one", () => {
    const managed = freshDir();
    writeBundle(bundle(managed), write);
    expect(removeBundle(managed, write)[0]?.action).toBe("removed");
    expect(existsSync(managed)).toBe(false);
    expect(removeBundle(freshDir(), write)).toEqual([]);

    const edited = freshDir();
    writeBundle(bundle(edited), write);
    writeFileSync(join(edited, "SKILL.md"), "hand edited\n");
    expect(removeBundle(edited, write)[0]?.action).toBe("refused");
    expect(removeBundle(edited, { force: true, dryRun: false })[0]?.action).toBe("removed");

    const foreign = freshDir();
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, "SKILL.md"), "not ours\n");
    expect(removeBundle(foreign, { force: true, dryRun: false })[0]?.action).toBe("refused");
  });
});
