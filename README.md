<p align="center">
  <img src="https://raw.githubusercontent.com/TheBlueHouse75/hermes-action-bridge/main/assets/logo.png" alt="Hermes Action Bridge" width="128" height="128" />
</p>

# Hermes Action Bridge

[![npm](https://img.shields.io/npm/v/hermes-action-bridge)](https://www.npmjs.com/package/hermes-action-bridge) [![CI](https://github.com/TheBlueHouse75/hermes-action-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/TheBlueHouse75/hermes-action-bridge/actions/workflows/ci.yml)

A configurable bridge that lets external agents delegate real-world actions to [Hermes Agent](https://hermes-agent.nousresearch.com/docs) without reimplementing Hermes skills, tools, platform integrations, browser automation, cron jobs, or messaging flows.

Use it from Claude Code, Codex, Cursor, CI jobs, shell scripts, or another
MCP-capable client. MCP execution requires interactive form elicitation and
fails closed in non-interactive clients; plan, draft, dry-run, and direct CLI
workflows remain available to automation.

```text
external agent -> hermes-action -> Hermes Agent -> skills/tools/integrations
```

## Why this exists

Coding agents are good at understanding a repository. They should not duplicate your automation stack.

If an agent needs to do something outside its local coding session — research, schedule a job, open a browser workflow, send a message, prepare a social post, use a Hermes skill, or coordinate with a messaging gateway — it can delegate that request to Hermes through this bridge.

## Features

- Generic `hermes-action run` command for one-shot delegation.
- Configurable presets for skills, toolsets, provider/model, source, and max turns.
- Deterministic, language-agnostic safety policy: downgrades `execute` to `request-approval` by default, with per-preset trust overrides.
- Explicit `--yolo` mode for users who intentionally want to bypass bridge-level policy.
- Context file injection with a per-file cap and a configurable aggregate budget (clear error instead of a cryptic `E2BIG`).
- Automatic large-context delivery: an oversized prompt is handed to Hermes through a secure temp file instead of overflowing the command line.
- Per-run timeouts (configurable, with per-mode defaults) that always reap the Hermes child process.
- Dry-run mode for debugging the exact Hermes command, prompt, and computed prompt size.
- Complete Codex and Claude Code installer: managed skill plus verified global MCP registration.
- MCP capability discovery, cancellable asynchronous jobs, and one-shot two-phase approvals gated on interactive form elicitation, with a privacy-preserving local audit log.
- Local stdio transport plus an opt-in, authenticated Streamable HTTP transport for Tailscale-restricted hosts.
- No project-specific assumptions. All behavior is configured through YAML and CLI flags.

## Requirements

- Node.js 20 or newer.
- Hermes Agent installed and available as `hermes`, or configured with a custom command path.

Check Hermes:

```bash
hermes --version
```

## Installation

Install from npm:

```bash
npm install -g hermes-action-bridge
```

Install the skill and MCP registration for Codex and Claude Code, then verify
the complete setup:

```bash
hermes-action --version
hermes-action install all
hermes-action doctor
```

Global installation is all-or-nothing for the requested agents. If Codex or
Claude Code is unavailable, conflicting, or cannot verify its user-scoped
stdio MCP entry, the command exits non-zero without installing the requested
skills. Use `--project` for an explicit skill-only setup.

### Other distribution channels

Choose the channel that matches the agent surface. Hermes Agent must always be
installed and configured on the same computer as the local bridge.

| Channel | What it configures | Install |
| --- | --- | --- |
| npm installer | Skill and verified user-scoped MCP for Codex CLI/app and Claude Code | `hermes-action install all` |
| Claude Code marketplace | Claude plugin with the Skill and a version-pinned MCP server | `claude plugin marketplace add TheBlueHouse75/hermes-action-bridge`, then `claude plugin install hermes-action@hermes-action-bridge` |
| Claude Desktop | Self-contained MCPB extension for the bridge runtime | From the [latest GitHub Release](https://github.com/TheBlueHouse75/hermes-action-bridge/releases/latest), download `hermes-action-bridge-<version>.mcpb` and open it with Claude Desktop |
| Agent Skills | Portable instructions for supported coding agents | `npx skills add TheBlueHouse75/hermes-action-bridge --skill hermes-action-bridge` |
| Smithery Skill | Public portable instructions in the Smithery Skill catalog | Check the [latest release notes](https://github.com/TheBlueHouse75/hermes-action-bridge/releases/latest) for the verified Skill listing or its pending status |
| Smithery MCPB | The same local MCPB bundle through the Smithery catalog | Check the [latest release notes](https://github.com/TheBlueHouse75/hermes-action-bridge/releases/latest) for the verified MCPB listing or its pending status |

The standalone Agent Skill only teaches an agent when and how to delegate; it
does not register an MCP server. Use the npm installer, Claude marketplace, or
MCPB channel when MCP tools are required.

Maintainers releasing a new version should follow the
[distribution runbook](docs/distribution-runbook.md), which covers the
automated release workflow and the manual directory publication checks.

Codex CLI and the Codex surface in the ChatGPT desktop app share the local
Codex MCP configuration on the same host. A general ChatGPT connector is a
different distribution target: it requires a remotely reachable MCP server
and is not installed by this local stdio bundle.

<details>
<summary>From source (for development)</summary>

```bash
git clone https://github.com/TheBlueHouse75/hermes-action-bridge.git
cd hermes-action-bridge
npm install
npm run build
npm link
```

</details>

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

- `plan`: Hermes is instructed to return a plan only. Treat it as open-world because configured tools remain available.
- `draft`: Hermes produces an artifact only. No external side effects.
- `execute`: Hermes may execute allowed actions, while still following Hermes' own safety rules.
- `request-approval`: Hermes prepares an action without executing it. MCP
  callers should use `hermes_prepare` and then `hermes_approve`; the latter
  opens an interactive client form showing the exact action and executes only
  after the human confirms it.

The policy guard is deterministic and language-agnostic: in `execute` mode the bridge switches to `request-approval` by default — regardless of the prompt's wording or language — unless the preset is explicitly trusted (empty `require_approval_for`) or `--yolo` is set. Separately, every effective MCP `execute` request requires interactive client confirmation, including trusted presets and YOLO. The bridge does not try to infer risk from keywords.

Risk categories below are **informational only**: the bridge surfaces the ones it recognizes in the prompt envelope to help you and Hermes decide, but they never drive the mode. (Keyword matching is English-biased and trivially evaded, so it must not be a security control.)

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

YOLO bypasses the mode-downgrade policy. It does not bypass the MCP interactive
confirmation barrier, Hermes Agent's own safety rules, provider/tool approval
prompts, or platform constraints. Direct CLI use remains an explicit trusted-local
escape hatch.

Use it only when the caller and environment are trusted.

## Trusted presets (direct execution)

By default every `execute` is downgraded to `request-approval` — the right default when an agent might act unattended. When *you* are the one asking for an action and want it to run without that extra gate, define a **trusted preset**: one whose `require_approval_for` is an empty list. Put it in your **user** config so it is yours alone and available in every project:

```yaml
# ~/.config/hermes-action/config.yaml   (user scope, merged before any project config)
presets:
  act:
    description: Direct execution of an action I explicitly asked for (trusted).
    require_approval_for: []
```

Run actions through it — `execute` stays `execute`, with no downgrade and no `--yolo` needed:

```bash
hermes-action run --preset act --mode execute "post the release note to #general"
```

**Keep it safe:**

- A trusted preset relaxes the mode-downgrade policy. Effective MCP execution still requires interactive confirmation; direct CLI execution relies on the operator and environment being trusted.
- Keep it in your **user** config; it never ships in the public package, and the distributed `SKILL.md` stays cautious for everyone else.
- Reserve trusted presets for actions a human explicitly asks for. Leave the conservative default for anything an agent could trigger on its own.

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
  # Aggregate budget across all --context files, in bytes (default ~768 KiB).
  # Raising this above ~896 KiB switches large prompts to temp-file delivery.
  max_context_bytes: 786432
  # Optional overall per-run timeout in seconds. When unset, per-mode defaults
  # apply: 180s for plan/draft, 600s for execute/request-approval.
  # timeout_seconds: 600

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
    # Per-preset override: relax approvals for a trusted preset.
    # An empty list never downgrades execute to request-approval.
    # require_approval_for: []

  coding:
    description: Repository inspection and runtime validation.
    skills: [developer-assurance-and-validation, runtime-debugging]
    toolsets: [terminal, file]

policy:
  yolo: false
  # Global default; a preset's own require_approval_for takes precedence when set.
  require_approval_for:
    - publish_external
    - send_message
    - send_email
    - delete
    - payment
    - git_push
    - credential_change
```

## Limits, timeouts, and large context

The bridge builds one prompt envelope (policy header + your request + every `<context>` block) and hands it to Hermes. Two guardrails keep that reliable:

- **Aggregate context budget** (`runtime.max_context_bytes`, default ~768 KiB, plus a fixed 250 KiB per-file cap). Exceeding it fails fast with an actionable message — `Context total N bytes exceeds the limit ... Split your handoff or raise runtime.max_context_bytes.` — instead of a cryptic `E2BIG` spawn crash. The default leaves headroom under the operating system's argument-size limit.
- **Large-context delivery.** If you raise the budget and the envelope grows past ~896 KiB, the adapter writes it to a `0600` temp file and tells Hermes to read that file (injecting a `file` toolset for the call). This sidesteps the OS argument limit. Two caveats: it adds one tool-calling turn, and the real ceiling becomes the model's context window — a multi-megabyte file may only be partially read. The temp file is removed after the run; only an uncatchable kill of the bridge process itself could leave it behind (mitigated by the `0600` mode and the OS temp reaper).

Every run is bounded by a timeout (default 180s for `plan`/`draft`, 600s for `execute`/`request-approval`). Override per run with `--timeout <seconds>` or globally with `runtime.timeout_seconds`. On expiry the Hermes child is sent `SIGTERM`, then `SIGKILL` after a short grace, and the result is marked as timed out.

`hermes-action doctor` prints the effective limits, and `hermes-action run --dry-run --json` reports the computed prompt size (`promptBytes`, `promptChars`) and whether delivery would use `argv` or a `temp-file`.

## CLI reference

```bash
hermes-action init [--file .hermes-action.yaml] [--force]
hermes-action run [options] "request"
hermes-action presets [--json]
hermes-action status [--json]
hermes-action mcp
hermes-action serve [--listen 127.0.0.1] [--port 8765]
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
--provider <name>
--model <name>
--max-turns <number>
--timeout <seconds>
--source <name>
--yolo
--dry-run
--json
```

## Native agent skills

Instead of pasting instructions and MCP snippets by hand, run the complete
installer. It installs the open-standard skill and registers the local stdio
MCP server through each agent's own CLI:

```bash
hermes-action install all            # skills + global MCP for both agents
hermes-action doctor                 # verifies skills, registrations, and MCP handshake
hermes-action install claude-code --print     # preview, write nothing
hermes-action install codex --project-hint     # also add a marker block to AGENTS.md
hermes-action uninstall all
```

Install behavior is safe by default: it uses a stable absolute bridge path,
does not depend on an interactive `PATH`, never modifies `CLAUDE.md` /
`AGENTS.md` unless you pass `--project-hint`, and refuses to overwrite either a
foreign skill or a customized MCP entry. Re-running it is idempotent. Use
`--project` for a project-local skill only and `--dry-run` to preview
operations.

The generated skill is shown in [`examples/claude-code/SKILL.md`](examples/claude-code/SKILL.md). Project-hint usage is documented in [`examples/claude-code/CLAUDE.md`](examples/claude-code/CLAUDE.md) and [`examples/codex/AGENTS.md`](examples/codex/AGENTS.md).

## Codex plugin (one-line install)

Codex users can install the delegation skill and the MCP server together as a plugin:

```bash
codex plugin marketplace add TheBlueHouse75/hermes-action-bridge
codex plugin add hermes-action@hermes-action-bridge
```

This registers the `hermes-action` MCP server and the Hermes delegation skill
in Codex. Hermes Agent must be installed locally — the plugin runs the
version-pinned npm package with `npx`.

> **Faster MCP startup:** `npx` re-resolves the package on every server start.
> The native installer registers the absolute global launcher instead.

## MCP configuration

Register the global MCP server for Codex and Claude Code without reinstalling
their skills:

```bash
hermes-action install mcp
```

For other JSON MCP clients, or a Claude Code project-scoped configuration,
write or merge `.mcp.json` directly while preserving other servers:

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

- `hermes_run`: delegate a request to Hermes. Optional overrides: `mode`, `preset`, `contextFiles`, `yolo`, `dryRun`, and — to trade cost for speed on simple tasks — `model`, `provider`, `maxTurns`, `timeoutSeconds`. Any effective `execute` request opens an interactive confirmation form first.
- `hermes_plan`: shortcut for `hermes_run` with `mode=plan`.
- `hermes_capabilities`: report configured presets, skills, toolsets, runtime, and policy without inventing live integrations.
- `hermes_presets`: list configured presets.
- `hermes_status`: check the configured Hermes runtime command.
- `hermes_submit`, `hermes_job_status`, `hermes_result`, `hermes_cancel`:
  manage bounded, process-local asynchronous jobs.
- `hermes_prepare`, `hermes_approve`, `hermes_reject`: create and consume a
  short-lived one-shot approval. `hermes_approve` asks the MCP client for
  interactive confirmation before execution.

The MCP surface delegates to Hermes instead of mirroring every Hermes tool.
Jobs and approvals are intentionally process-local: restarting the MCP server
clears them. Audit events are written as owner-only JSONL metadata under
`$XDG_STATE_HOME/hermes-action/audit.jsonl` (or
`~/.local/state/hermes-action/audit.jsonl`) without prompt, context, token, or
full result content.

## Remote MCP over Tailscale

The HTTP transport is opt-in and loopback-only by default:

```bash
hermes-action serve --listen 127.0.0.1 --port 8765
```

Prefer placing Tailscale Serve in front of that loopback endpoint. Forwarded
`*.ts.net` requests still require a bearer token, so start the loopback server
with `--token-env`:

```bash
export HERMES_ACTION_HTTP_TOKEN="<at-least-32-random-bytes>"
hermes-action serve \
  --listen 127.0.0.1 \
  --port 8765 \
  --token-env HERMES_ACTION_HTTP_TOKEN
```

For direct tailnet listening, the bridge accepts only an explicit Tailscale
IPv4 address and requires the same bearer-token setup:

```bash
hermes-action serve \
  --listen 100.64.0.10 \
  --port 8765 \
  --allow-tailnet \
  --token-env HERMES_ACTION_HTTP_TOKEN
```

The token is never accepted as a CLI value or stored in bridge configuration.
Public/wildcard and non-Tailscale addresses are refused.

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

## Security model

Direct CLI execution assumes a trusted, supervised operator. MCP execution has
an additional protocol-enforced gate: every effective `execute` request asks
the client for MCP form elicitation, shows the exact action and metadata, and
runs only when the response is both `accept` and `confirm=true`.

For side effects, prefer the testable two-phase flow: `hermes_prepare` returns
a local no-tool summary and opaque approval ID, and `hermes_approve` opens the
interactive confirmation before consuming the unchanged request exactly once.
Unsupported clients, CI jobs, shell scripts, cancellations, timeouts, and
declines fail closed without execution. Use plan, draft, dry-run, or the direct
CLI when an interactive MCP client is unavailable; do not describe the direct
CLI as providing a distinct human-approval barrier.

This gate assumes a conforming, trusted MCP client. The
[MCP specification](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation#user-interaction-model)
requires clients that advertise elicitation to provide UI, identify the
requesting server, offer decline/cancel, and let the user review the response.
A malicious client, or an elicitation hook configured to auto-answer, can forge
`accept` and `confirm=true`; do not expose the bridge to untrusted MCP clients.
The bridge does not claim a human boundary in that deployment model.

The bridge's own guard is a secondary net: `execute` is downgraded to `request-approval` by default unless a preset is trusted (empty `require_approval_for`) or `--yolo` is set. The bridge never injects `--yolo` or a bypass flag on its own.

- **Do not auto-answer MCP elicitation or install an elicitation hook that
  accepts execution forms.** Doing so deliberately removes the human boundary.
- **Do not allowlist `hermes-action run` (`execute`/`yolo`)**. A command-pattern
  allowlist cannot distinguish a safe plan from an execution with side effects.
- Do not put secrets in `.hermes-action.yaml`. Keep provider credentials in Hermes Agent, your OS keychain, or the platform's secure store.
- Treat `--yolo` as a trusted-local escape hatch, not a default.

## Also by the author

Built by Cyril Guilleminot, who also makes offline-first voice tools:

- [Weesper Neon Flow](https://weesperneonflow.ai) — speak text into any app at 3× typing speed, fully offline (macOS & Windows).
- [Weesper Transcribe](https://apps.apple.com/app/id6778776535) — offline transcription on the macOS App Store.

## License

MIT
