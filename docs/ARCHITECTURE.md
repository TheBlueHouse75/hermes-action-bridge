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
- `src/mcp-server.ts`: MCP server factory, delegation tools, jobs, and approval orchestration.
- `src/http-server.ts`: authenticated, opt-in Streamable HTTP transport.
- `src/capabilities.ts`: configuration-backed capability inventory.
- `src/jobs.ts`: bounded process-local asynchronous jobs.
- `src/approvals.ts`: short-lived, one-shot approval records.
- `src/audit-log.ts`: privacy-preserving owner-only JSONL audit metadata.
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
- `src/install/mcp-service.ts`: native Codex/Claude MCP registration, inspection, conflict handling, and removal.
- `src/install/install-service.ts`: per-agent install/uninstall with failure isolation.

The global default is a complete installation: managed skill plus MCP
registration through each agent's native CLI, using the bridge's absolute
launcher path. Defaults remain conservative: never modify `CLAUDE.md` /
`AGENTS.md` without `--project-hint`, never overwrite foreign skills or
customized MCP entries, and stay idempotent.

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

- `plan`: prompt-level plan-only policy; callers must still treat configured Hermes tools as open-world.
- `draft`: produce an artifact, no external side effects.
- `execute`: execute allowed actions.
- `request-approval`: prepare the action and ask for approval.

## Policy

Direct CLI and `hermes_run` calls rely on the **host agent's approval prompt**.
The structured MCP path adds a second deterministic barrier:
`hermes_prepare` creates a local no-tool summary, stores an immutable short-lived request, and
`hermes_approve` consumes it exactly once. The bridge never treats its own model
output as human approval.

The bridge's own guard is a secondary, deterministic net: in `mode=execute` it changes the effective mode to `request-approval` unless the preset/policy is explicitly trusted (empty `require_approval_for`) or YOLO is enabled. This is independent of the prompt's language or wording.

Keyword risk detection (`detectRisks`) is **informational only**: recognized categories are listed in the prompt envelope to help the human and Hermes decide, but they never drive the mode. Keyword matching is English-biased and easily evaded, so it is not treated as a security control.

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

The MCP server exposes orchestration primitives instead of mirroring every
Hermes tool.

Tools:

- `hermes_run`
- `hermes_plan`
- `hermes_capabilities`
- `hermes_presets`
- `hermes_status`
- `hermes_submit`
- `hermes_job_status`
- `hermes_result`
- `hermes_cancel`
- `hermes_prepare`
- `hermes_approve`
- `hermes_reject`

The server advertises routing instructions that distinguish Hermes-owned
connected services and automation from ordinary local coding work. Capability
discovery reports declarative presets and runtime status only; it does not
claim that a Hermes integration is live without a stable Hermes introspection
API.

Jobs are memory-only, concurrency-limited, cancellable, output-bounded, and
expire after 24 hours. Approval records expire after 15 minutes and are
one-shot. Audit JSONL stores only identifiers, modes, risks, prompt hashes, and
terminal metadata with `0600` permissions.

## HTTP transport

`hermes-action serve` exposes `/mcp` using Streamable HTTP. It binds loopback by
default. Direct non-loopback binding requires an explicit address in
`100.64.0.0/10`, `--allow-tailnet`, and a bearer token read from an environment
variable. The server validates Host, authenticates in constant time, restricts
direct peers to Tailscale CGNAT, limits request size and active sessions, and
never exposes an unauthenticated diagnostics endpoint.

Tailscale Serve in front of a loopback listener remains the preferred remote
deployment because TLS and tailnet identity stay outside the bridge. Requests
forwarded with a `*.ts.net` Host still require the bridge bearer token.

### Transitive Hono advisory

MCP SDK 1.29.0 currently depends on `@hono/node-server` 1.x, which npm flags
under [GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9).
That advisory applies only to the package's `serve-static` middleware on
Windows. The bridge never imports that middleware, serves no static files, and
rejects every HTTP path except `/mcp`, so the vulnerable code path is not
reachable here.

Re-evaluate this acceptance when the v1 SDK updates its Hono dependency, or
before adding static-file serving, a Hono middleware layer, or any HTTP route
that maps request paths to the filesystem. Do not force Hono 2 through an npm
override: the current SDK declares `^1.19.9`, and doing so produces an invalid
dependency tree for global installs.
