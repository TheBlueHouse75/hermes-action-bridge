# Complete Agent Installation and MCP Runtime Design

## Goal

Make Hermes Action Bridge install as a complete product for Codex and Claude
Code. A successful default installation must expose both the native skill and
the MCP tools, and `doctor` must prove that the installed agents can discover
and start the bridge.

The same release also adds the approved bridge capabilities: explicit
capability discovery, cancellable asynchronous jobs, two-phase execution
approval with a privacy-preserving audit trail, and an opt-in Streamable HTTP
transport suitable for a Tailscale-restricted host.

## Product boundaries

- Hermes remains the action runtime. The bridge does not mirror Hermes tools or
  guess which integrations are live.
- The default installation is local and global to the current OS user.
- Remote serving is never enabled by installation and never binds outside
  loopback without an explicit opt-in plus bearer authentication.
- Existing synchronous MCP tools remain compatible.
- No installer path overwrites a customized MCP entry without an explicit,
  actionable conflict.
- Prompts, context documents, tokens, and full results are not written to audit
  logs.

## Installation contract

### Default

```bash
hermes-action install all
```

For each available target, this command:

1. Installs or updates the managed `SKILL.md`.
2. Resolves a stable absolute launcher for the current bridge installation.
3. Registers `hermes-action` through the agent's native CLI:
   - `codex mcp add hermes-action -- <launcher> mcp`
   - `claude mcp add --scope user --transport stdio hermes-action -- <launcher> mcp`
4. Reads the resulting entry back with the native CLI.
5. Reports success, absence, skip, or conflict separately per agent.

An identical entry is idempotent. A different entry with the same name is a
conflict and is never silently replaced. Global installation is transactional:
if any requested agent CLI is unavailable or cannot accept the verified MCP
registration, no requested skill is written and the command exits non-zero.
Use `--project` only when a deliberately skill-only installation is wanted.

`--dry-run` performs discovery and reports the intended operations without
writing. `--print` prints the skill. `--project` remains skill-only so it never
silently creates a user-scoped Codex registration; project MCP configuration
stays available through the explicit `install mcp --write` path.

### Removal

```bash
hermes-action uninstall all
```

Removal deletes the managed skill and calls the native agent removal command
only when the current MCP entry still matches the bridge-managed launcher.
Customized entries are preserved and reported as conflicts.

### Doctor

`hermes-action doctor` checks, independently:

- Node, bridge configuration, Hermes runtime, and effective limits;
- Codex and Claude Code CLI availability;
- managed skill state;
- native MCP registration state and exact launcher/arguments;
- a stdio MCP initialize/list-tools handshake exposing the required tool set.

An installed agent with an absent, conflicting, or non-starting MCP entry makes
the report fail. An unavailable agent is a warning only when it has neither a
skill nor an MCP registration.

## MCP discovery contract

The server publishes concise instructions that define when Hermes should and
should not be selected. Tool descriptions identify concrete Hermes-owned
capabilities such as messaging, schedules, integrations, and persistent remote
state, while excluding ordinary local code edits already handled by the host
agent.

`hermes_capabilities` returns only facts known by the bridge:

- bridge version and active transport;
- Hermes availability and version;
- configured presets, skills, toolsets, and model/provider overrides;
- effective bridge policy;
- an explicit statement that live Hermes integration discovery is unsupported
  until Hermes exposes a stable introspection API.

## Asynchronous job contract

The initial job store is process-local and memory-only. It uses UUIDs, a bounded
concurrency limit, a 24-hour TTL, bounded output capture, and periodic cleanup.
It never stores the expanded prompt envelope or context file contents.

Tools:

- `hermes_submit`: validate and start a job.
- `hermes_job_status`: return lifecycle metadata.
- `hermes_result`: return the bounded final output.
- `hermes_cancel`: idempotently request cancellation.

States are `queued`, `running`, `succeeded`, `failed`, `cancelled`, and
`timed_out`. The Hermes adapter exposes a cancellable handle while retaining
the current awaited wrapper for backward compatibility. Cancellation sends
`SIGTERM`, then `SIGKILL` after the existing grace period.

## Two-phase approval and audit

`hermes_prepare` creates a deterministic local summary without invoking Hermes
or any configured tool, then stores a normalized pending request with a short
expiry. It returns an opaque approval ID and the summary. `hermes_approve`
consumes that ID once and submits the
unchanged request as an execution job. `hermes_reject` consumes it without
execution.

Approval records are process-local in this release. They cannot be replayed
after restart, edited between phases, or reused after approval/rejection.

The audit log is append-only JSONL with owner-only permissions. It records
timestamp, event, opaque IDs, requested/effective mode, preset, detected risks,
transport/principal, prompt hash, and terminal status. It never records prompt
text, context contents, bearer tokens, or full stdout/stderr. Logging failures
fail closed for approval transitions.

## Remote transport

```bash
hermes-action serve --listen 127.0.0.1 --port 8765
```

Loopback serving is allowed without authentication for local-only use.
Non-loopback serving requires all of:

- `--allow-tailnet`;
- an address inside Tailscale CGNAT space (`100.64.0.0/10`);
- a bearer token read from a named environment variable;
- authenticated requests to `/mcp`.

The implementation uses MCP Streamable HTTP, constant-time token comparison,
request-size limits, expected-host validation, bounded sessions/concurrency,
and no unauthenticated diagnostic endpoint. Tailscale Serve in front of a
loopback listener remains the preferred deployment because it supplies TLS and
tailnet identity without putting certificates in the bridge.

## Packaging and compatibility

- Bump the release version consistently across npm, plugin, and server
  metadata.
- Package the plugin directory in the npm tarball.
- Use `mcpServers` in plugin JSON manifests.
- Keep Node 20+, strict TypeScript, ESM, and the existing SDK.
- Do not publish, tag, or create a release as part of this change.

## Verification

Automated:

- unit tests for native registration parsing, idempotence, conflicts, removal,
  capabilities, jobs, cancellation, approvals, audit privacy, HTTP auth, host
  validation, and version synchronization;
- functional installation tests with isolated homes and fake Codex/Claude
  executables;
- stdio and Streamable HTTP MCP client handshakes;
- package tarball inspection;
- full `npm run check`.

Mac mini acceptance:

1. Install the built package over the existing global installation.
2. Run `hermes-action install all --yes`.
3. Verify `codex mcp get hermes-action --json` and
   `claude mcp get hermes-action`.
4. Run `hermes-action doctor`.
5. Start fresh Codex and Claude Code sessions and confirm that the advertised
   Hermes tools are visible.
6. Call `hermes_status`, `hermes_capabilities`, and a harmless
   `hermes_plan`.

Quality gates:

1. Full validation passes.
2. Simplify loop reaches zero actionable findings.
3. Integrated Codex review loop reaches zero findings.
4. Final diff and staged diff are reviewed before commit and push.
