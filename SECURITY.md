# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | ✓         |
| < 0.2   | ✗         |

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

- **Preferred:** use GitHub's private vulnerability reporting on this repository
  (the **Security** tab → **Report a vulnerability**).
- If that is unavailable, open a minimal public issue asking for a private
  contact channel — do not include exploit details in the issue.

Expect an initial response within a few days. Please allow reasonable time for a
fix before public disclosure.

## Scope and hardening notes

`hermes-action-bridge` delegates actions to Hermes Agent and does not store
provider secrets itself. Keep credentials in Hermes Agent or your OS keychain,
never in `.hermes-action.yaml`.

Areas of particular interest for reports:

- the risk policy and the `--yolo` bypass,
- the MCP server surface,
- the installer's file writes: skill folders, the optional `CLAUDE.md` / `AGENTS.md`
  marker block, and the `.mcp.json` merge.

The installer is conservative by design: it never edits instruction files without
`--project-hint`, refuses to overwrite files it did not generate, and is idempotent.
