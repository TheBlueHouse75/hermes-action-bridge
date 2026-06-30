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
- `src/context.ts`: context file loading with size guardrails.
- `src/adapters/hermes-cli.ts`: Hermes CLI adapter.
- `src/mcp-server.ts`: minimal MCP server.
- `src/status.ts`: runtime availability check.

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

## MCP design

The MCP server exposes a small delegation surface instead of mirroring every Hermes tool.

Tools:

- `hermes_run`
- `hermes_plan`
- `hermes_presets`
- `hermes_status`

This keeps schema drift low and lets Hermes remain the action runtime.
