# Hermes Action Bridge

[![CI](https://github.com/TheBlueHouse75/hermes-action-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/TheBlueHouse75/hermes-action-bridge/actions/workflows/ci.yml)

A configurable bridge that lets external agents delegate real-world actions to [Hermes Agent](https://hermes-agent.nousresearch.com/docs) without reimplementing Hermes skills, tools, platform integrations, browser automation, cron jobs, or messaging flows.

Use it from Claude Code, Codex, Cursor, CI jobs, shell scripts, or any MCP-capable client.

```text
external agent -> hermes-action -> Hermes Agent -> skills/tools/integrations
```

## Why this exists

Coding agents are good at understanding a repository. They should not duplicate your automation stack.

If an agent needs to do something outside its local coding session — research, schedule a job, open a browser workflow, send a message, prepare a social post, use a Hermes skill, or coordinate with a messaging gateway — it can delegate that request to Hermes through this bridge.

## Features

- Generic `hermes-action run` command for one-shot delegation.
- Configurable presets for skills, toolsets, provider/model, profile, source, and max turns.
- Safety policy that can downgrade risky `execute` requests to `request-approval`.
- Explicit `--yolo` mode for users who intentionally want to bypass bridge-level policy.
- Context file injection with size limits.
- Dry-run mode for debugging the exact Hermes command and prompt.
- Minimal MCP server exposing delegation tools: `hermes_run`, `hermes_plan`, `hermes_presets`, and `hermes_status`.
- No project-specific assumptions. All behavior is configured through YAML and CLI flags.

## Requirements

- Node.js 20 or newer.
- Hermes Agent installed and available as `hermes`, or configured with a custom command path.

Check Hermes:

```bash
hermes --version
```

## Installation

From a local checkout:

```bash
npm install
npm run build
npm link
```

Then:

```bash
hermes-action --version
hermes-action status
```

When published to npm, installation will be:

```bash
npm install -g hermes-action-bridge
```

## Quick start

Create a config file in your project:

```bash
hermes-action init
```

Ask Hermes for a safe plan:

```bash
hermes-action run --mode plan "Find the best next action from this repository context."
```

Delegate with a context file:

```bash
hermes-action run \
  --preset research \
  --context ./notes.md \
  "Analyze this and return the next concrete action."
```

Run a dry-run to inspect what will be sent to Hermes:

```bash
hermes-action run --dry-run --json "Summarize this project."
```

## Execution modes

- `plan`: Hermes returns a plan only. No side effects.
- `draft`: Hermes produces an artifact only. No external side effects.
- `execute`: Hermes may execute allowed actions, while still following Hermes' own safety rules.
- `request-approval`: Hermes prepares the action and asks the human for approval before irreversible external effects.

If the bridge detects a risky request in `execute` mode, it can automatically switch to `request-approval` unless YOLO is enabled.

Risk categories:

- `publish_external`
- `send_message`
- `send_email`
- `delete`
- `payment`
- `git_push`
- `credential_change`

## YOLO mode

YOLO mode is off by default.

```bash
hermes-action run --yolo --mode execute "Do the task now."
```

YOLO only bypasses the bridge policy. It does not remove Hermes Agent's own safety rules, provider/tool approval prompts, or platform constraints.

Use it only when the caller and environment are trusted.

## Configuration

`hermes-action` loads config in this order:

```text
CLI flags > project .hermes-action.yaml > user config > built-in defaults
```

User config path:

```text
~/.config/hermes-action/config.yaml
```

Project config path:

```text
.hermes-action.yaml
```

Example:

```yaml
runtime:
  adapter: hermes-cli
  command: hermes

defaults:
  mode: plan
  source: external-agent
  max_turns: 30
  preset: default

presets:
  default:
    description: No extra skills or toolsets. Uses the active Hermes profile.
    skills: []
    toolsets: []

  research:
    description: General research and synthesis.
    skills: []
    toolsets: [web, terminal, file]

  coding:
    description: Repository inspection and runtime validation.
    skills: [developer-assurance-and-validation, runtime-debugging]
    toolsets: [terminal, file]

policy:
  yolo: false
  require_approval_for:
    - publish_external
    - send_message
    - send_email
    - delete
    - payment
    - git_push
    - credential_change
```

## CLI reference

```bash
hermes-action init [--file .hermes-action.yaml] [--force]
hermes-action run [options] "request"
hermes-action presets [--json]
hermes-action status [--json]
hermes-action mcp
hermes-action install <claude-code|codex|all|mcp> [options]
hermes-action uninstall <claude-code|codex|all|mcp> [options]
hermes-action doctor [--json] [--probe]
```

Common `run` options:

```bash
--mode <plan|draft|execute|request-approval>
--preset <name>
--context <path...>
--config <path>
--profile <name>
--provider <name>
--model <name>
--max-turns <number>
--source <name>
--yolo
--dry-run
--json
```

## Native agent skills

Instead of pasting instructions by hand, install a native skill so Claude Code and Codex know when to delegate to Hermes. The skill is the same open-standard `SKILL.md` for both agents; the CLI stays the deterministic execution layer.

```bash
hermes-action doctor                 # check Node, Hermes, agents, and installed skills
hermes-action install all            # ~/.claude/skills and ~/.codex/skills
hermes-action install claude-code --print     # preview, write nothing
hermes-action install codex --project-hint     # also add a marker block to AGENTS.md
hermes-action uninstall all
```

Install behavior is safe by default: it never modifies `CLAUDE.md` / `AGENTS.md` unless you pass `--project-hint`, refuses to overwrite a file it did not generate, and is idempotent. Use `--project` for a project-local skill and `--dry-run` to preview operations.

The generated skill is shown in [`examples/claude-code/SKILL.md`](examples/claude-code/SKILL.md). Project-hint usage is documented in [`examples/claude-code/CLAUDE.md`](examples/claude-code/CLAUDE.md) and [`examples/codex/AGENTS.md`](examples/codex/AGENTS.md).

## MCP configuration

Print the config snippet for your client (Claude Code / Cursor / VS Code use JSON; Codex uses TOML):

```bash
hermes-action install mcp
```

For Claude Code, write or merge the project `.mcp.json` directly (preserving other servers):

```bash
hermes-action install mcp --write
```

Or configure it by hand:

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

## Direct delegation

You can always call the bridge directly, without a skill:

```bash
hermes-action run --mode plan "Ask Hermes what should happen next."

hermes-action run \
  --preset coding \
  --context ./codex-notes.md \
  "Use Hermes to validate this plan and identify missing runtime checks."
```

## MCP tools

Run:

```bash
hermes-action mcp
```

Exposed tools:

- `hermes_run`: delegate a request to Hermes.
- `hermes_plan`: shortcut for `hermes_run` with `mode=plan`.
- `hermes_presets`: list configured presets.
- `hermes_status`: check the configured Hermes runtime command.

The MCP surface is intentionally small. The bridge delegates to Hermes instead of exposing every Hermes tool one by one.

## Development

```bash
npm install
npm run build
npm run test
npm run check
```

Functional tests use a fake Hermes binary to verify command construction, prompt wrapping, risk policy, and YOLO behavior without spending LLM credits.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): module map, config precedence, modes, policy, and MCP design.
- [Functional testing](docs/FUNCTIONAL-TESTS.md): automated tests and live smoke-test procedures.
- [Contributing](CONTRIBUTING.md): local setup, development rules, and release checklist.
- [Changelog](CHANGELOG.md): release history.
- [Security policy](SECURITY.md): how to report a vulnerability.

## Security notes

- Do not put secrets in `.hermes-action.yaml`.
- Keep provider credentials in Hermes Agent, your OS keychain, or the relevant platform's secure store.
- Use `request-approval` for public posting, outbound email/messages, deletes, payments, credential changes, and git pushes.
- Treat `--yolo` as a trusted-local-mode escape hatch, not as a default.

## License

MIT
