import { describe, expect, it } from "vitest";
import { removeBlock, upsertBlock } from "../src/install/marker-block.js";

const start = "<!-- hermes-action-bridge:start -->";
const end = "<!-- hermes-action-bridge:end -->";

describe("marker block", () => {
  it("creates a block when the file is absent", () => {
    const result = upsertBlock(null, "hint");
    expect(result.action).toBe("created");
    expect(result.content).toContain(start);
    expect(result.content).toContain("hint");
    expect(result.content).toContain(end);
  });

  it("appends a block while preserving existing content", () => {
    const result = upsertBlock("# Existing rules\n", "hint");
    expect(result.action).toBe("updated");
    expect(result.content.startsWith("# Existing rules\n")).toBe(true);
    expect(result.content).toContain(`${start}\nhint\n${end}`);
  });

  it("is idempotent and only updates when the inner text changes", () => {
    const once = upsertBlock("# Rules\n", "hint").content;
    expect(upsertBlock(once, "hint").action).toBe("unchanged");
    const changed = upsertBlock(once, "new hint");
    expect(changed.action).toBe("updated");
    expect(changed.content).toContain("new hint");
    expect(changed.content).not.toContain(">hint<");
    expect(changed.content.startsWith("# Rules\n")).toBe(true);
  });

  it("refuses to touch malformed markers", () => {
    const broken = `# Rules\n${start}\nhint\n`;
    expect(upsertBlock(broken, "hint").action).toBe("refused");
    expect(removeBlock(broken).action).toBe("refused");
  });

  it("removes the block and leaves surrounding content", () => {
    const withBlock = upsertBlock("# Keep me\n", "hint").content;
    const removed = removeBlock(withBlock);
    expect(removed.action).toBe("removed");
    expect(removed.content).toContain("# Keep me");
    expect(removed.content).not.toContain(start);
    expect(removeBlock("# No block here\n").action).toBe("unchanged");
  });

  it("removes the block without collapsing blank lines elsewhere in the file", () => {
    const withGaps = "# A\n\n\n\n# B\n";
    const removed = removeBlock(upsertBlock(withGaps, "hint").content);
    expect(removed.action).toBe("removed");
    expect(removed.content).toContain("# A\n\n\n\n# B");
    expect(removed.content).not.toContain(start);
  });
});
