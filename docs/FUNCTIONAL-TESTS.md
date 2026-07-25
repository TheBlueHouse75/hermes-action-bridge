# Functional Testing

This project has two validation layers.

## Automated tests

Run:

```bash
npm run check
```

This executes:

- TypeScript build with `tsc`.
- Vitest unit tests.
- Functional CLI tests using a fake Hermes executable.

The fake Hermes tests verify:

- `hermes-action run` calls the configured Hermes command.
- Skills and toolsets are passed as CLI flags.
- Risky `execute` requests become `request-approval`.
- `--yolo` passes through and keeps `execute` mode.
- The prompt envelope contains mode, preset, YOLO state, detected risks, user request, and context.
- A failed Hermes run is surfaced through the MCP server as an error result (`isError`).

The installer tests verify (with injected home/cwd and temp `HOME`, no real agents required):

- `install` / `uninstall` manage both skills and native MCP registrations,
  remain idempotent, preserve customized registrations, and never touch
  `CLAUDE.md` / `AGENTS.md` by default.
- `--dry-run` and `--print` write nothing; `--force` replaces a managed skill; a non-managed file is refused.
- `--project-hint` adds and removes a marker block without losing existing content.
- `--project` installs a project-local skill without creating the global one.
- `install mcp --write` merges and `uninstall mcp --write` unmerges the project `.mcp.json`, preserving other servers.
- `doctor` verifies skills, registrations, and an in-memory MCP handshake;
  `--probe` accepts the sentinel on stdout or stderr.
- The shipped `examples/*/SKILL.md` match the installer template exactly (no drift).
- asynchronous jobs enforce concurrency, cancellation, TTL, and bounded UTF-8
  output;
- approvals are immutable, short-lived, and one-shot, while audit records omit
  prompt and output content;
- the Streamable HTTP server completes an MCP handshake on loopback and rejects
  public binding, weak/missing authentication, and non-Tailscale addresses.

The distribution tests verify:

- Claude Code marketplace and plugin manifests use the npm package version and
  the checked-in, version-pinned MCP configuration.
- The canonical skills.sh copy remains byte-identical to both the installer
  template and the plugin Skill.
- The MCPB manifest matches the package version and the generated archive
  contains the bridge runtime and its production dependencies without secrets
  or machine-specific paths.

Build the Claude Desktop/Smithery artifact explicitly with:

```bash
npm run build:mcpb
npm run inspect:mcpb
npm test -- tests/mcpb-distribution.test.ts
```

## Live Hermes smoke test

Use a safe dry-run first:

```bash
npm run build
node dist/cli.js run --dry-run --json "Return the word BRIDGE_OK only."
```

Then run a minimal real Hermes call if you intentionally want to spend provider tokens:

```bash
node dist/cli.js run \
  --mode plan \
  --max-turns 2 \
  "Return the word BRIDGE_OK only. Do not use tools."
```

## Claude Code smoke test

After `npm link`, install over any existing configuration:

```bash
hermes-action install all --yes
claude mcp get hermes-action
hermes-action doctor
```

Expected result:

- The managed Claude skill is current.
- The MCP entry points to the absolute linked bridge launcher with argument `mcp`.
- `doctor` reports `skill:claude-code`, `mcp:claude-code`, and
  `mcp:handshake` as passing.

## Codex smoke test

Verify the same installation from Codex:

```bash
codex mcp get hermes-action --json
```

The command and arguments must match the current absolute bridge launcher.

## MCP smoke test

Configure an MCP client with:

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

Call `hermes_status` and `hermes_capabilities` first. They should report the
runtime and declarative presets without spending provider tokens.

Then call `hermes_plan` before making real side-effecting calls. Validate a
two-phase action with `hermes_prepare`; call `hermes_reject` unless a human
explicitly approves the exact request returned in `preview.action`.
