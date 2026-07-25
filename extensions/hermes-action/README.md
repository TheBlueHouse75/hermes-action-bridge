# Hermes Action Bridge MCP Bundle

This MCP Bundle installs a self-contained Hermes Action Bridge runtime in
Claude Desktop. It includes the compiled bridge and its production Node.js
dependencies, so starting the MCP server does not require downloading packages
or network access. Hermes Agent itself is not bundled.

Hermes Agent must already be installed and configured on the same computer.
The bridge applies its local policy before delegating an action to Hermes.

No API key, user configuration, or machine-specific path is included in this
bundle.
