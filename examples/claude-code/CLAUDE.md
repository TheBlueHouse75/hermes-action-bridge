# Claude Code Instructions: Hermes Action Bridge

When a task requires capabilities outside this coding session, do not reimplement those integrations inside Claude Code.

Delegate to Hermes through `hermes-action`.

## Use cases

Use `hermes-action` when the task involves:

- Hermes skills or memory.
- Messaging platforms.
- Browser automation.
- Cron jobs or scheduled automation.
- External research workflows.
- Platform integrations already configured in Hermes.
- Any real-world action that is not local code editing.

## Default safe pattern

```bash
hermes-action run --mode plan "Describe what Hermes should do for this task."
```

## With context

Write relevant context to a file, then pass it explicitly:

```bash
hermes-action run \
  --preset coding \
  --context ./claude-code-context.md \
  "Ask Hermes to validate this plan and identify missing runtime checks."
```

## External side effects

For public posts, outbound messages, emails, deletes, payments, credential changes, or git pushes, use `request-approval` unless the human explicitly enabled YOLO mode:

```bash
hermes-action run \
  --mode request-approval \
  "Prepare the external action and ask for approval before executing."
```

## Debug first

Before relying on the bridge in a new repository, run:

```bash
hermes-action status
hermes-action run --dry-run --json "Return BRIDGE_OK only."
```

## Do not

- Do not store secrets in `.hermes-action.yaml`.
- Do not call platform APIs directly when Hermes already owns that integration.
- Do not use `--yolo` unless the human explicitly requested trusted local execution.
