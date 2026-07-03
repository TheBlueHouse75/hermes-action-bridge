# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Documentation

- Added a "Trusted presets (direct execution)" README section: how to define a `require_approval_for: []`
  preset in user config to run `execute` actions without the approval gate, plus the safety trade-offs
  (keep it in user scope, never allowlist `hermes-action run`).

## [0.4.0] - 2026-07-03

Deterministic security model, per-call MCP overrides, and installer hardening.

### Added

- MCP `hermes_run` now accepts `model`, `provider`, `maxTurns`, and `timeoutSeconds` overrides, so a
  caller can pick a faster model or cap the tool-calling budget per request (previously only settable via a
  preset).

### Fixed

- `install mcp --write` on an empty or whitespace-only `.mcp.json` (e.g. after `touch`) now initializes it
  instead of failing with "not valid JSON".
- `install mcp --write` no longer silently overwrites a customized `hermes-action` entry in `.mcp.json`; it
  refuses with an actionable message so a custom command/args is never lost.
- Removed the non-functional `profile` option (`--profile`, `defaults.profile`, `preset.profile`). The
  Hermes CLI has no per-invocation profile flag — profiles are switched globally with `hermes profile use`
  — so a configured profile made the bridge emit an invalid `hermes --profile … chat` command. Target a
  specific Hermes profile via `runtime.command` (e.g. a `hermes profile alias` wrapper) instead.

### Changed

- **Policy is now deterministic and language-agnostic.** In `execute` mode the bridge downgrades to
  `request-approval` by default — regardless of the prompt's wording or language — unless the preset is
  explicitly trusted (empty `require_approval_for`) or `--yolo` is set. Previously the downgrade fired only
  when an English keyword was detected, so non-English side-effecting prompts (e.g. `supprime…`, `paie…`)
  silently ran in `execute`. Keyword risk detection is retained but is now **informational only** (surfaced
  in the prompt envelope), never a security control. The real barrier is the host agent's approval prompt.

### Documentation

- Documented the security model: host-agent approval is the deterministic barrier; do not allowlist
  `hermes-action run` (`execute`/`yolo`) in the coding agent.

## [0.3.0] - 2026-06-30

Execution robustness and large-context support.

### Added

- Aggregate context budget (`runtime.max_context_bytes`, default ~768 KiB) on top of the
  per-file cap, with an actionable error instead of a cryptic `E2BIG` spawn failure.
- Large-context delivery: an envelope above ~896 KiB is written to a `0600` temp file and read
  by Hermes (with an injected `file` toolset), sidestepping the OS argument-size limit. The temp
  dir is cleaned up on every exit path.
- Per-run timeouts: `--timeout <seconds>` and `runtime.timeout_seconds`, with per-mode defaults
  (180s plan/draft, 600s execute/request-approval). The Hermes child is reaped with `SIGTERM`
  then `SIGKILL`; the result is flagged when it times out.
- Per-preset `require_approval_for` overrides (e.g. an empty list to relax a trusted preset),
  resolved over the global policy.
- Diagnostics: `doctor` reports the effective limits, and `run --dry-run` reports the computed
  prompt size (`promptBytes` / `promptChars`) and the delivery mode (`argv` / `temp-file`).

### Changed

- Every MCP tool (`hermes_run`, `hermes_plan`, `hermes_presets`, `hermes_status`) is wrapped in
  a single error boundary, so bad input (unknown preset, missing/oversized context) returns a
  structured `isError` result instead of crashing the server.
- `status` and `doctor` version probes use a short `spawnSync` timeout so a hanging Hermes cannot
  block them.

## [0.2.3] - 2026-06-30

### Fixed

- MCP Registry namespace case: the server is published as
  `io.github.TheBlueHouse75/hermes-action-bridge` (the registry namespace matches the
  GitHub account's exact case), aligning `mcpName` and `server.json` so registry
  publishing succeeds.

## [0.2.2] - 2026-06-30

### Added

- Official MCP Registry listing: `server.json` manifest and the `mcpName`
  ownership declaration in `package.json`.
- The release workflow now also publishes the MCP server to `registry.modelcontextprotocol.io`
  via GitHub OIDC (no token), keeping `server.json` in sync with `package.json` automatically.

## [0.2.1] - 2026-06-30

### Changed

- Documented the published npm install (`npm install -g hermes-action-bridge`) as the primary path.

### Internal

- Release workflow publishes to npm via OIDC Trusted Publishing (no long-lived token) with provenance.

## [0.2.0] - 2026-06-30

### Added

- Native agent skills installer: `hermes-action install|uninstall <claude-code|codex|all|mcp>`.
  Installs the open-standard `SKILL.md` to `~/.claude/skills` and `~/.codex/skills`.
- `hermes-action doctor` (`--json`, `--probe`): checks Node, configuration, Hermes availability,
  Claude Code / Codex availability, and installed-skill state.
- Opt-in project hints (`--project-hint`): a marker-managed block in `CLAUDE.md` / `AGENTS.md`.
- Project-scoped skills (`--project`) and MCP config help: `install mcp` prints per-client snippets
  (JSON for Claude Code / Cursor / VS Code, TOML for Codex); `install mcp --write` merges the
  project `.mcp.json`, preserving other servers.
- `--dry-run` and `--print` (write nothing) and `--force` (replace a managed skill).

### Changed

- The MCP server reports failed Hermes runs as errors (`isError`) and surfaces both stdout and
  stderr instead of hiding failure detail.
- The package version is sourced from `package.json` in one place; build and packaging hardened so
  local drafts never ship in the npm tarball.

### Security

- The installer never modifies `CLAUDE.md` / `AGENTS.md` without `--project-hint`, refuses to
  overwrite a file it did not generate, stays idempotent, and resolves paths cross-platform.

## [0.1.0]

### Added

- Initial Hermes Action Bridge: `run`, `presets`, `status`, `mcp`, and `init` commands.
- Configurable presets, a conservative risk policy (downgrade risky `execute` to `request-approval`),
  an explicit `--yolo` escape hatch, context-file injection with size limits, dry-run mode, and a
  minimal MCP server exposing `hermes_run`, `hermes_plan`, `hermes_presets`, and `hermes_status`.
