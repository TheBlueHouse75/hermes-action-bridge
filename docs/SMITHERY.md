# Smithery local stdio release

Hermes Action Bridge reaches Smithery as the same local stdio MCPB bundle used
by Claude Desktop. The archive contains the bridge runtime and its locked
production dependencies, but never Hermes Agent, user configuration,
credentials, or machine-specific paths.

## Maintainer procedure

[The Smithery MCPB publication section of the distribution runbook](distribution-runbook.md#6-smithery-mcpb-publication)
is the canonical release procedure. Follow it to build and inspect the exact
GitHub Release artifact, authenticate with `smithery auth login`, publish it,
and retain the resulting Smithery server-page URL as proof.

Smithery publication is deliberately interactive and manual: do not commit a
Smithery token, API key, or other credential, and do not add one to CI. There
is no repository-owned Smithery manifest; the inspected versioned `.mcpb`
archive is the submitted artifact.

## Sources

- [Smithery: Publish](https://smithery.ai/docs/build/publish)
- [Smithery CLI reference](https://smithery.ai/docs/concepts/cli)
