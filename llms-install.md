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

## Configure the MCP server

No global install is required — `npx` fetches the package on demand. Add this to
the client's MCP settings (`cline_mcp_settings.json` for Cline, or any
`mcpServers` block):

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
- `hermes_presets` — list configured presets.
- `hermes_status` — check the configured Hermes runtime command.

## Safety notes

- The bridge applies a conservative policy: risky `execute` requests (publish,
  send message/email, delete, payment, git push, credential change) are
  downgraded to `request-approval` unless `--yolo` is explicitly set.
- Do not put secrets in the bridge config — keep provider credentials in Hermes
  Agent or your OS keychain.

## Uninstall

- Remove the `hermes-action` entry from the client's `mcpServers` settings.
- If installed globally: `npm uninstall -g hermes-action-bridge`.
