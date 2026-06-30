import { createHash } from "node:crypto";

/** Short, stable content hash used to detect drift between an installed file and the current template. */
export function contentVersion(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Shared `SKILL.md` body. Identical for Claude Code and Codex (SKILL.md is an open standard). */
export function skillMarkdown(): string {
  return `---
name: hermes-action-bridge
description: Delegate external actions, Hermes skills, browser automation, messaging, cron jobs, and integrations to Hermes Agent through hermes-action. Use when a task needs capabilities outside the local coding session.
---

# Hermes Action Bridge

Use this skill when a task needs capabilities outside the local coding session:
Hermes skills or memory, messaging platforms, browser automation, scheduled or
cron automation, external research, or any platform integration already
configured in Hermes Agent.

Do not reimplement those integrations here. Delegate them to Hermes through the
\`hermes-action\` CLI.

## When to use

- The task requires a Hermes skill, tool, profile, or connected service.
- The task needs a real-world action that is not local code editing.
- The task needs research, messaging, browser, or scheduled automation Hermes owns.

## Safe default

Ask Hermes for a plan first; it has no side effects:

\`\`\`bash
hermes-action run --mode plan "<describe what Hermes should do>"
\`\`\`

## With context

Write a concise handoff to a file and pass it explicitly:

\`\`\`bash
hermes-action run --preset coding --context ./handoff.md "<request>"
\`\`\`

## External side effects

For public posts, outbound email or messages, deletes, payments, credential
changes, or git pushes, require human approval:

\`\`\`bash
hermes-action run --mode request-approval "<request requiring side effects>"
\`\`\`

Never use \`--yolo\` unless the human explicitly asked for trusted local
execution. It bypasses only the bridge policy, not Hermes' own safety rules.

## Verify setup

\`\`\`bash
hermes-action status
hermes-action run --dry-run --json "Return BRIDGE_OK only."
\`\`\`
`;
}

/** Inner text of the marker-managed hint added to CLAUDE.md / AGENTS.md (opt-in only). */
export function projectHint(): string {
  return [
    "When a task requires Hermes Agent capabilities (skills, memory, messaging,",
    "browser automation, cron, research, or platform integrations), use the",
    "`hermes-action-bridge` skill and delegate through `hermes-action`. Prefer",
    "`--mode plan` or `--mode request-approval`; never use `--yolo` unless the",
    "human explicitly requested trusted local execution.",
  ].join("\n");
}

/** MCP config snippet for JSON clients (Claude Code, Cursor, VS Code). */
export function mcpSnippetJson(): string {
  return `${JSON.stringify(
    { mcpServers: { "hermes-action": { command: "hermes-action", args: ["mcp"] } } },
    null,
    2,
  )}\n`;
}

/** MCP config snippet for Codex (`~/.codex/config.toml`, TOML format). */
export function mcpSnippetCodexToml(): string {
  return ['[mcp_servers.hermes-action]', 'command = "hermes-action"', 'args = ["mcp"]', ""].join("\n");
}
