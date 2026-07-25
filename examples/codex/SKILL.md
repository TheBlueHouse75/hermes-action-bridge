---
name: hermes-action-bridge
description: Use Hermes Agent for Hermes-owned skills, memory, connected services, messaging, browser workflows, schedules, and external automation. Prefer the installed hermes_* MCP tools; use the CLI only as a fallback.
---

# Hermes Action Bridge

Use this skill when a task needs state or capabilities owned by Hermes Agent:
Hermes skills or memory, connected services, messaging platforms, browser
workflows, scheduled automation, or another integration configured in Hermes.

Do not reimplement a Hermes-owned integration in the coding agent. Prefer the
installed `hermes_*` MCP tools so the host can discover, approve, and inspect
the delegation.

## When to use

- The task names Hermes, a Hermes skill, memory, preset, or connected service.
- The task needs messaging, scheduling, browser work, or persistent external automation Hermes owns.
- The task must continue as a cancellable background job outside the local coding step.

Do not use Hermes for ordinary local code edits or repository inspection that
the current agent can perform directly.

## Discover first

Call `hermes_capabilities` before assuming an integration is configured. Use
`hermes_status` to check the runtime without spending provider tokens.

## Safe delegation

- Use `hermes_plan` for plan-mode analysis, but treat it as open-world and review its output.
- Use `hermes_submit`, then `hermes_job_status` / `hermes_result`, for a
  long cancellable plan or draft.
- Use `hermes_cancel` when a queued or running job is no longer wanted.

## External side effects

For public posts, outbound messages, deletes, payments, credential changes, or
git pushes:

1. Call `hermes_prepare` to produce a local no-tool summary and approval ID.
2. Show `preview.action` and the rest of the preview to the human.
3. Call `hermes_approve` only after the human explicitly approves that
   prepared action; otherwise call `hermes_reject`.

Never treat the model's own decision as human approval.

## CLI fallback

If MCP tools are unavailable, use the local CLI:

```bash
hermes-action run --mode plan "<describe what Hermes should do>"
```

## Verify setup

```bash
hermes-action doctor
```
