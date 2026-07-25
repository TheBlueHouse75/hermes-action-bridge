# Hermes Action Bridge distribution bundle

## Goal

Extend the existing npm, official MCP Registry, Glama, and Codex plugin
distribution with four low-friction channels:

1. a Claude Code plugin marketplace;
2. a Claude Desktop DXT/MCPB bundle;
3. a canonical Agent Skill layout discoverable by `skills.sh`;
4. a Smithery-ready local stdio release based on the same MCPB artifact.

The runtime behavior and public MCP tool contract must remain unchanged.

## Shared constraints

- Hermes Agent remains a local prerequisite.
- Marketplace MCP launchers must pin the released
  `hermes-action-bridge` version instead of following `latest`; the MCPB must
  embed the matching compiled runtime and locked production dependencies.
- The canonical skill content stays generated from
  `src/install/templates.ts`; every distributed copy must be covered by a
  drift test.
- Bundles must not include secrets, user configuration, or machine-specific
  absolute paths.
- Claude/Codex marketplace metadata must identify the version-pinned npm stdio
  entry point. MCPB metadata must identify its bundled Node entry point.
- Existing Codex plugin and native installer behavior must remain compatible.

## Claude Code plugin marketplace

Add a Claude Code marketplace at `.claude-plugin/marketplace.json` and a
Claude-compatible plugin manifest under the existing
`plugins/hermes-action/` bundle.

The plugin must expose:

- the existing `hermes-action-bridge` skill;
- the existing `.mcp.json` stdio server;
- version, repository, license, description, and author metadata;
- a GitHub-hosted marketplace install path.

Validation must parse both manifests, confirm their version matches
`package.json`, and confirm the referenced skill and MCP files exist.

## Claude Desktop DXT/MCPB

Add a source bundle that follows the current Anthropic MCPB manifest schema.
It must launch the compiled bridge and locked production dependencies bundled
with the artifact through Claude Desktop's Node runtime, without bundling
Hermes Agent itself.

The build command must generate a versioned `.mcpb` artifact in an ignored
release-output directory. Packaging must be deterministic enough for CI:
the archive contents and manifest can be inspected without installing it.

Validation must check:

- manifest schema-required fields;
- package version synchronization;
- stdio command and arguments;
- bundled icon/documentation paths;
- absence of secrets and absolute local paths.

## Agent Skill distribution

Expose the canonical skill at:

`skills/hermes-action-bridge/SKILL.md`

This path is intended for open Agent Skill installers including `skills.sh`.
The file must remain byte-for-byte identical to the installer template and
the existing Codex plugin copy.

Document a copy-paste installation command that selects the single skill.
The documentation must make clear that the skill is the discovery layer and
that the MCP/native installer is still required for execution.

## Smithery

Use the generated MCPB artifact as the local stdio release submitted to
Smithery. Add repository metadata and release documentation, but do not
store Smithery credentials.

If Smithery exposes no stable repository-owned declarative manifest for MCPB
publication, provide:

- a deterministic package command;
- a documented authenticated publish command;
- a release checklist item;
- CI validation of the artifact, without attempting an authenticated publish.

## Documentation

Update the README with a short distribution matrix and copy-paste commands for
Claude Code, Claude Desktop, Agent Skills, Smithery, and the existing Codex
plugin. Avoid presenting remote ChatGPT/Claude.ai support as complete: those
surfaces still require a remote MCP deployment.

Update the architecture and functional-test documentation only where the new
packaging or validation flow needs explanation.

## Acceptance criteria

- `npm run build` passes.
- `npm test` passes.
- New focused metadata/package tests pass.
- A generated MCPB archive can be listed and inspected locally.
- Claude Code marketplace files reference valid in-repository components.
- All distributed skill copies match the canonical template.
- No existing installer, MCP, policy, or runtime test regresses.
- Simplify completes with zero actionable findings.
- Integrated review-loop completes with zero findings.
