import type { BridgeMode, PolicyConfig, RiskCategory } from "./types.js";

const riskMatchers: Array<{ risk: RiskCategory; pattern: RegExp }> = [
  { risk: "publish_external", pattern: /\b(publish|post|tweet|linkedin|reddit|x\.com|twitter|social)\b/i },
  { risk: "send_message", pattern: /\b(send|message|dm|discord|telegram|slack|whatsapp|sms)\b/i },
  { risk: "send_email", pattern: /\b(email|e-mail|gmail|send mail|reply to)\b/i },
  { risk: "delete", pattern: /\b(delete|remove|destroy|drop|wipe|rm\s+-rf)\b/i },
  { risk: "payment", pattern: /\b(pay|payment|purchase|buy|subscribe|credit card|checkout)\b/i },
  { risk: "git_push", pattern: /\b(git push|push to|publish branch|create repo|gh repo create)\b/i },
  { risk: "credential_change", pattern: /\b(token|secret|api key|credential|password|oauth|keychain)\b/i },
];

export interface PolicyDecision {
  mode: BridgeMode;
  requestedMode: BridgeMode;
  detectedRisks: RiskCategory[];
  approvalRequired: boolean;
}

export function detectRisks(text: string): RiskCategory[] {
  const risks = new Set<RiskCategory>();
  for (const matcher of riskMatchers) {
    if (matcher.pattern.test(text)) risks.add(matcher.risk);
  }
  return [...risks];
}

export function applyPolicy(requestedMode: BridgeMode, policy: PolicyConfig, prompt: string, yoloFlag: boolean): PolicyDecision {
  // Detected risks are informative only: they are surfaced to the human and to Hermes, but they never
  // decide the mode. Keyword matching cannot be a security barrier — it is English-biased and trivially
  // evaded by paraphrase. The real, deterministic, language-agnostic barrier is the host agent's approval
  // prompt (Claude Code / Codex asking the human before the call runs). See docs/ARCHITECTURE.md.
  const detectedRisks = detectRisks(prompt);
  const yolo = yoloFlag || policy.yolo;
  // Deterministic guard: any `execute` is downgraded to request-approval unless this context is explicitly
  // trusted (empty requireApprovalFor) or yolo is set. Independent of the prompt's language or wording.
  const guardActive = policy.requireApprovalFor.length > 0;
  const approvalRequired = !yolo && guardActive && requestedMode === "execute";
  const mode = approvalRequired ? "request-approval" : requestedMode;
  return { mode, requestedMode, detectedRisks, approvalRequired };
}
