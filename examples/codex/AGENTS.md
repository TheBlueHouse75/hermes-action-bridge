# Codex: Hermes Action Bridge

Install the native skill so Codex knows when to delegate real-world actions to Hermes:

```bash
hermes-action install codex
```

This writes `~/.codex/skills/hermes-action-bridge/SKILL.md`. Preview the exact content first with:

```bash
hermes-action install codex --print
```

To add a small marker-managed hint to this project's `AGENTS.md` (instead of, or in addition to, the global skill):

```bash
hermes-action install codex --project-hint
```

The generated skill is shown in [SKILL.md](SKILL.md). Check your setup with `hermes-action doctor`. Remove everything with `hermes-action uninstall codex --project-hint`.
