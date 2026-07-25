# Installing hermes-action-bridge (for Cline and other agents)

`hermes-action-bridge` is an MCP server that lets an agent delegate real-world
actions (research, browser workflows, messaging, scheduling, Hermes skills/tools)
to [Hermes Agent](https://hermes-agent.nousresearch.com/docs) instead of
reimplementing them.

## Prerequisites

- **Node.js 20+**.
- **Hermes Agent** installed and available as `hermes` on `PATH` — the bridge
  delegates to it. Verify with `hermes --version`.
  - Without Hermes, the MCP server still starts and exposes its tools, but
    delegation calls return a clear error explaining that the Hermes runtime is
    not configured. Run `npx -y hermes-action-bridge doctor` to check.

## Complete Codex / Claude Code installation

For Codex or Claude Code, prefer the complete global installation. It installs
the native skill and registers the MCP server through each agent's CLI:

```bash
npm install -g hermes-action-bridge
hermes-action install all
hermes-action doctor
```

## Other MCP clients

For Cline or another JSON MCP client, no global install is required. Add this
to its `mcpServers` block:

```json
{
  "mcpServers": {
    "hermes-action": {
      "command": "npx",
      "args": ["-y", "hermes-action-bridge", "mcp"]
    }
  }
}
```

If you prefer a global install (`npm install -g hermes-action-bridge`), use:

```json
{
  "mcpServers": {
    "hermes-action": {
      "command": "hermes-action",
      "args": ["mcp"]
    }
  }
}
```

## Verify the setup

```bash
npx -y hermes-action-bridge doctor
```

This checks Node, the Hermes runtime command, and the bridge configuration.

## Tools exposed

- `hermes_run` — delegate a request to Hermes.
- `hermes_plan` — `hermes_run` with `mode=plan` (a plan only, no side effects).
- `hermes_capabilities` — inspect configured presets, skills, toolsets, runtime, and policy.
- `hermes_presets` — list configured presets.
- `hermes_status` — check the configured Hermes runtime command.
- `hermes_submit`, `hermes_job_status`, `hermes_result`, `hermes_cancel` —
  manage cancellable asynchronous jobs.
- `hermes_prepare`, `hermes_approve`, `hermes_reject` — enforce an explicit,
  one-shot two-phase approval before execution.

## Safety notes

- The bridge applies a conservative policy: `execute` is downgraded to
  `request-approval` by default. Use `hermes_prepare`, present its preview to
  the human, and call `hermes_approve` only after explicit approval.
- Do not put secrets in the bridge config — keep provider credentials in Hermes
  Agent or your OS keychain.

## Uninstall

- Remove the `hermes-action` entry from the client's `mcpServers` settings.
- If installed globally: `npm uninstall -g hermes-action-bridge`.
