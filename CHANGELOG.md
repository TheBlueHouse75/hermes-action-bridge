# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
