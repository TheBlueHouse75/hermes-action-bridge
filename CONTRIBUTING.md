# Contributing

Thanks for considering a contribution.

## Local setup

```bash
npm install
npm run check
```

## Development rules

- Keep the bridge generic. Do not add project-specific presets to the default package.
- Prefer configuration over hardcoded workflows.
- Do not add provider or platform secrets to examples or tests.
- Keep the MCP surface small and stable.
- Add tests for any policy, config, adapter, or prompt-envelope change.

## Release checklist

```bash
npm run check
npm pack --dry-run
git diff --check
```

Verify the package from the packed tarball before publishing to npm.
