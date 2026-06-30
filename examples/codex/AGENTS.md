# Codex Instructions: Hermes Action Bridge

When a task requires capabilities outside this coding session, delegate to Hermes through `hermes-action` instead of reimplementing integrations in Codex.

## When to delegate

Use the bridge for:

- Hermes skills and established workflows.
- Browser automation.
- Messaging, social, email, or platform actions.
- Cron jobs and scheduled automation.
- Research workflows that Hermes is configured to perform.
- Actions that need Hermes' memory, tools, profiles, or connected services.

## Safe default

```bash
hermes-action run --mode plan "Ask Hermes what should happen next."
```

## Context handoff

If Codex has useful repository context, write a concise handoff file and pass it:

```bash
hermes-action run \
  --preset coding \
  --context ./codex-handoff.md \
  "Use Hermes to inspect this handoff and perform the appropriate next step."
```

## Approval boundary

Do not execute public posts, outbound email/messages, deletes, payments, credential changes, or git pushes through the bridge without explicit human approval.

Use:

```bash
hermes-action run --mode request-approval "Prepare this action and ask for approval."
```

## YOLO mode

Only use YOLO if the human explicitly requested it:

```bash
hermes-action run --yolo --mode execute "Do the task now."
```

YOLO bypasses the bridge policy only. Hermes still applies its own safety constraints.
