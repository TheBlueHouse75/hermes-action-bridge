# Architecture

Hermes Action Bridge is deliberately small. It does not try to become another automation platform.

Its job is to let an external agent ask Hermes Agent to handle a task, while applying a local, configurable policy layer.

```text
Claude Code / Codex / Cursor / CI / shell
        |
        v
hermes-action CLI or MCP server
        |
        v
Hermes Agent CLI session
        |
        v
Hermes skills, tools, browser automation, MCPs, cron jobs, messaging, APIs
```

## Core modules

- `src/cli.ts`: command-line interface.
- `src/config.ts`: YAML config loading and normalization.
- `src/policy.ts`: risk detection and mode switching.
- `src/prompt.ts`: prompt envelope sent to Hermes.
- `src/context.ts`: context file loading with a per-file cap and an aggregate budget.
- `src/adapters/hermes-cli.ts`: Hermes CLI adapter (argv or temp-file prompt delivery, child-process timeout).
- `src/mcp-server.ts`: minimal MCP server.
- `src/status.ts`: runtime availability check.
- `src/version.ts`: single source of truth for the package version.
- `src/doctor.ts`: environment checks for `hermes-action doctor`.

## Native skills installer (`src/install/`)

The `install` / `uninstall` commands install an open-standard `SKILL.md` for Claude Code (`~/.claude/skills/`) and Codex (`~/.codex/skills/`). The CLI remains the deterministic execution layer; the skill only tells the agent when to delegate.

- `src/install/paths.ts`: cross-platform skill and instruction-file paths (injectable home/cwd).
- `src/install/templates.ts`: single source for the `SKILL.md` body, project hint, and MCP snippets.
- `src/install/managed-file.ts`: lock-based provenance for skill bundles (classify, atomic write, refuse-unmanaged).
- `src/install/marker-block.ts`: fail-safe marker block for the optional `CLAUDE.md` / `AGENTS.md` hint.
- `src/install/file-edit.ts`: shared read-edit-write helper used by the hint and the `.mcp.json` writer.
- `src/install/mcp-config.ts`: MCP snippets and the Claude Code `.mcp.json` merge/unmerge writer.
- `src/install/install-service.ts`: per-agent install/uninstall with failure isolation.

Defaults are conservative: never modify `CLAUDE.md` / `AGENTS.md` without `--project-hint`, never overwrite a file the installer did not generate, and stay idempotent.

## Config precedence

The bridge merges config in this order:

```text
built-in defaults -> user config -> project config -> CLI flags
```

User config:

```text
~/.config/hermes-action/config.yaml
```

Project config:

```text
.hermes-action.yaml
```

## Modes

The bridge does not decide how Hermes completes the task. It only labels the requested behavior:

- `plan`: no side effects.
- `draft`: produce an artifact, no external side effects.
- `execute`: execute allowed actions.
- `request-approval`: prepare the action and ask for approval.

## Policy

Policy is intentionally conservative and transparent.

When a prompt contains risky intent and `mode=execute`, the bridge changes the effective mode to `request-approval` unless YOLO is enabled.

The detected risks are included in the prompt envelope so Hermes knows why the mode changed.

## YOLO

YOLO is explicit and local:

```bash
hermes-action run --yolo --mode execute "..."
```

It bypasses the bridge policy only. Hermes Agent still enforces its own rules and any tool/provider/platform approval flow.

## Prompt delivery and runtime limits

The adapter builds one prompt envelope (policy header + request + `<context>` blocks) and delivers it to `hermes chat -Q`:

- **Small envelopes** ride the command line as `-q <text>` — the original, lowest-overhead path.
- **Large envelopes** (above ~896 KiB, kept below the OS `ARG_MAX`) are written to a `0600` file in a per-run `mkdtemp` directory; Hermes is given a short pointer query and a `file` toolset so it reads the file itself. This avoids `E2BIG`. The temp directory is removed on every exit path. The path is opt-in: the default context budget keeps envelopes below the threshold, so it engages only when `runtime.max_context_bytes` is raised.

`src/context.ts` enforces a fixed 250 KiB per-file cap and a configurable aggregate budget so oversized handoffs fail with a clear message before reaching `spawn`.

Every child process is bounded by a timeout (per-mode defaults, overridable via `--timeout` or `runtime.timeout_seconds`): on expiry it is sent `SIGTERM`, then `SIGKILL` after a grace period. The status/doctor `--version` probes use a short synchronous timeout for the same reason.

## MCP design

The MCP server exposes a small delegation surface instead of mirroring every Hermes tool.

Tools:

- `hermes_run`
- `hermes_plan`
- `hermes_presets`
- `hermes_status`

This keeps schema drift low and lets Hermes remain the action runtime.
