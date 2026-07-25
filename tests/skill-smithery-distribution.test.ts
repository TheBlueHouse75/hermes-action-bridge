import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Smithery distribution documentation", () => {
  it("links to the canonical runbook and keeps the Smithery-specific security guidance", () => {
    const smitheryGuide = readFileSync(join(root, "docs", "SMITHERY.md"), "utf8");

    expect(smitheryGuide).toContain("distribution-runbook.md#6-smithery-mcpb-publication");
    expect(smitheryGuide).toContain("smithery auth login");
    expect(smitheryGuide).toContain("Smithery server-page URL");
    expect(smitheryGuide).toContain("versioned `.mcpb`");
    expect(smitheryGuide).not.toMatch(/SMITHERY_API_KEY\s*=/);
  });
});
