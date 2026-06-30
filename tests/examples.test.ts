import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { skillMarkdown } from "../src/install/templates.js";

const root = process.cwd();

describe("examples", () => {
  it("ship the exact generated skill so the docs cannot drift from the installer", () => {
    const expected = skillMarkdown();
    expect(readFileSync(join(root, "examples", "claude-code", "SKILL.md"), "utf8")).toBe(expected);
    expect(readFileSync(join(root, "examples", "codex", "SKILL.md"), "utf8")).toBe(expected);
    expect(
      readFileSync(join(root, "plugins", "hermes-action", "skills", "hermes-action-bridge", "SKILL.md"), "utf8"),
    ).toBe(expected);
  });
});
