import type { EffectiveRun } from "./types.js";

export function buildHermesPrompt(run: EffectiveRun): string {
  const contextBlock = run.contextDocuments.length
    ? run.contextDocuments
        .map((doc) => `<context path="${escapeAttribute(doc.path)}">\n${doc.content}\n</context>`)
        .join("\n\n")
    : "<context>None provided.</context>";

  return [
    "You are Hermes Agent being called by an external agent through hermes-action-bridge.",
    "",
    `Mode: ${run.mode}`,
    `Requested mode: ${run.requestedMode}`,
    `Preset: ${run.presetName}`,
    `YOLO: ${run.yolo ? "enabled" : "disabled"}`,
    `Detected risks: ${run.detectedRisks.length ? run.detectedRisks.join(", ") : "none"}`,
    "",
    "Policy:",
    "- Follow the user's request using the tools and skills available in this Hermes session.",
    "- If Mode is plan, return a plan only. Do not perform side effects.",
    "- If Mode is draft, produce the requested artifact only. Do not perform external side effects.",
    "- If Mode is request-approval, prepare the action and explicitly ask the human for approval before irreversible external effects.",
    "- If Mode is execute, perform allowed actions, but still obey Hermes' own safety rules and any platform approval prompts.",
    "- Never reveal secrets. Do not print API keys, OAuth tokens, passwords, private keys, or session cookies.",
    "",
    "External agent request:",
    run.prompt,
    "",
    "Context files:",
    contextBlock,
  ].join("\n");
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
