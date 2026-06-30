import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const cli = join(process.cwd(), "src", "cli.ts");

describe("CLI functional bridge", () => {
  it("runs a fake Hermes command with policy-applied prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-functional-"));
    const fakeHermes = join(dir, "fake-hermes.js");
    writeFileSync(
      fakeHermes,
      [
        "#!/usr/bin/env node",
        "const qIndex = process.argv.indexOf('-q');",
        "const prompt = qIndex >= 0 ? process.argv[qIndex + 1] : '';",
        "console.log(JSON.stringify({ argv: process.argv.slice(2), prompt }));",
      ].join("\n"),
    );
    chmodSync(fakeHermes, 0o755);
    writeFileSync(
      join(dir, ".hermes-action.yaml"),
      [
        "runtime:",
        `  command: ${JSON.stringify(fakeHermes)}`,
        "defaults:",
        "  mode: execute",
        "  source: functional-test",
        "  max_turns: 3",
        "  preset: default",
        "presets:",
        "  default:",
        "    skills: [hermes-agent]",
        "    toolsets: [terminal]",
      ].join("\n"),
    );

    const output = execFileSync("npx", ["tsx", cli, "run", "Publish this on X"], { cwd: dir, encoding: "utf8" });
    const payload = JSON.parse(output) as { argv: string[]; prompt: string };
    expect(payload.argv).toContain("--skills");
    expect(payload.argv).not.toContain("--yolo");
    expect(payload.prompt).toContain("Mode: request-approval");
    expect(payload.prompt).toContain("Detected risks: publish_external");
  });

  it("keeps execute mode and passes --yolo when yolo is enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-yolo-"));
    const fakeHermes = join(dir, "fake-hermes.js");
    writeFileSync(fakeHermes, "#!/usr/bin/env node\nconst q=process.argv.indexOf('-q'); console.log(JSON.stringify({ argv: process.argv.slice(2), prompt: process.argv[q+1] }));\n");
    chmodSync(fakeHermes, 0o755);
    writeFileSync(
      join(dir, ".hermes-action.yaml"),
      [
        "runtime:",
        `  command: ${JSON.stringify(fakeHermes)}`,
        "defaults:",
        "  mode: execute",
        "  source: functional-test",
        "  preset: default",
        "presets:",
        "  default:",
        "    skills: []",
        "    toolsets: []",
      ].join("\n"),
    );

    const output = execFileSync("npx", ["tsx", cli, "run", "--yolo", "Publish this on X"], { cwd: dir, encoding: "utf8" });
    const payload = JSON.parse(output) as { argv: string[]; prompt: string };
    expect(payload.argv).toContain("--yolo");
    expect(payload.prompt).toContain("Mode: execute");
    expect(payload.prompt).toContain("YOLO: enabled");
  });
});
