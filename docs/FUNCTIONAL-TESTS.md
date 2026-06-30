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

- `install` / `uninstall` are idempotent and never touch `CLAUDE.md` / `AGENTS.md` by default.
- `--dry-run` and `--print` write nothing; `--force` replaces a managed skill; a non-managed file is refused.
- `--project-hint` adds and removes a marker block without losing existing content.
- `--project` installs a project-local skill without creating the global one.
- `install mcp --write` merges and `uninstall mcp --write` unmerges the project `.mcp.json`, preserving other servers.
- `doctor` assembles its checks and JSON report, and `--probe` accepts the sentinel on stdout or stderr.
- The shipped `examples/*/SKILL.md` match the installer template exactly (no drift).

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

After `npm link`, ask Claude Code to run:

```bash
hermes-action run --dry-run --json "Return BRIDGE_OK only."
```

Expected result:

- The command exits `0`.
- The JSON output contains a `command` array starting with `hermes chat -Q`.
- The prompt contains `Mode: plan`.

## Codex smoke test

After `npm link`, ask Codex to run:

```bash
hermes-action run --dry-run --json "Return BRIDGE_OK only."
```

Expected result is the same as Claude Code.

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

Call `hermes_status` first. It should report whether the configured Hermes command is available.

Then call `hermes_run` with `dryRun: true` before making real Hermes calls.
