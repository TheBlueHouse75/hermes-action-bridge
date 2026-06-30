# Claude Code: Hermes Action Bridge

Install the native skill so Claude Code knows when to delegate real-world actions to Hermes:

```bash
hermes-action install claude-code
```

This writes `~/.claude/skills/hermes-action-bridge/SKILL.md`. Preview the exact content first with:

```bash
hermes-action install claude-code --print
```

To add a small marker-managed hint to this project's `CLAUDE.md` (instead of, or in addition to, the global skill):

```bash
hermes-action install claude-code --project-hint
```

The generated skill is shown in [SKILL.md](SKILL.md). Check your setup with `hermes-action doctor`. Remove everything with `hermes-action uninstall claude-code --project-hint`.
