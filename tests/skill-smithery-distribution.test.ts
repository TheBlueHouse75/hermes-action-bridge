import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Smithery distribution documentation", () => {
  it("links to the canonical runbook and keeps the Smithery-specific security guidance", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const smitheryGuide = readFileSync(join(root, "docs", "SMITHERY.md"), "utf8");
    const runbook = readFileSync(join(root, "docs", "distribution-runbook.md"), "utf8");
    const skillSection = runbook.slice(
      runbook.indexOf("## 6. Smithery Skill publication"),
      runbook.indexOf("## 7. Smithery MCPB publication"),
    );
    const cleanWorktreeCheck = 'test -z "$(git status --porcelain)"';
    const releaseCommitCheck = 'test "$(git rev-parse HEAD)" = "$(git rev-parse "v<version>^{commit}")"';
    const publishCommand =
      "smithery skill publish skills/hermes-action-bridge --namespace <namespace> --name hermes-action-bridge";

    expect(smitheryGuide).toContain("distribution-runbook.md#7-smithery-mcpb-publication");
    expect(runbook).toContain("## 6. Smithery Skill publication");
    expect(skillSection).toContain(cleanWorktreeCheck);
    expect(skillSection).toContain(releaseCommitCheck);
    expect(skillSection.indexOf(cleanWorktreeCheck)).toBeLessThan(skillSection.indexOf(publishCommand));
    expect(skillSection.indexOf(releaseCommitCheck)).toBeLessThan(skillSection.indexOf(publishCommand));
    expect(skillSection).toContain(publishCommand);
    expect(runbook).toContain("## 7. Smithery MCPB publication");
    expect(readme).toContain("| Smithery Skill |");
    expect(readme).toContain("| Smithery MCPB |");
    expect(smitheryGuide).toContain("smithery auth login");
    expect(smitheryGuide).toContain("Smithery server-page URL");
    expect(smitheryGuide).toContain("versioned `.mcpb`");
    expect(smitheryGuide).not.toMatch(/SMITHERY_API_KEY\s*=/);
  });
});
