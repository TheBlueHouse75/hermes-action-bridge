export const modes = ["plan", "draft", "execute", "request-approval"] as const;
export type BridgeMode = (typeof modes)[number];

export type RuntimeAdapter = "hermes-cli";

export interface RuntimeConfig {
  adapter: RuntimeAdapter;
  command: string;
  /** Aggregate budget across all --context files (bytes). Default leaves headroom under ARG_MAX; the adapter does the precise envelope-size check. */
  maxContextBytes: number;
  /** Overall child-process timeout (seconds). When unset, per-mode defaults apply (see run.ts). */
  timeoutSeconds?: number | undefined;
}

export interface PresetConfig {
  description?: string | undefined;
  skills: string[];
  toolsets: string[];
  provider?: string | undefined;
  model?: string | undefined;
  profile?: string | undefined;
  maxTurns?: number | undefined;
  source?: string | undefined;
  /** Per-preset override of the risk categories that force request-approval. Falls back to the global policy when unset. */
  requireApprovalFor?: RiskCategory[] | undefined;
}

export interface DefaultsConfig {
  mode: BridgeMode;
  profile?: string | undefined;
  source: string;
  maxTurns: number;
  preset: string;
}

export type RiskCategory =
  | "publish_external"
  | "send_message"
  | "send_email"
  | "delete"
  | "payment"
  | "git_push"
  | "credential_change";

export interface PolicyConfig {
  yolo: boolean;
  requireApprovalFor: RiskCategory[];
}

export interface BridgeConfig {
  runtime: RuntimeConfig;
  defaults: DefaultsConfig;
  presets: Record<string, PresetConfig>;
  policy: PolicyConfig;
}

export interface RunOptions {
  prompt: string;
  mode?: BridgeMode | undefined;
  preset?: string | undefined;
  contextFiles: string[];
  yolo: boolean;
  dryRun: boolean;
  json: boolean;
  profile?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  maxTurns?: number | undefined;
  source?: string | undefined;
  timeoutSeconds?: number | undefined;
}

export interface ContextDocument {
  path: string;
  content: string;
}

export interface EffectiveRun {
  mode: BridgeMode;
  requestedMode: BridgeMode;
  presetName: string;
  preset: PresetConfig;
  prompt: string;
  source: string;
  profile?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  maxTurns: number;
  yolo: boolean;
  detectedRisks: RiskCategory[];
  contextDocuments: ContextDocument[];
  /** Resolved overall timeout for this run (seconds). Covers the whole session — chat -Q emits only the final response, so there is no per-turn timeout. */
  timeoutSeconds: number;
}

export interface AdapterResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string[];
  prompt: string;
  dryRun: boolean;
  /** True when the child was killed because it exceeded the timeout. */
  timedOut?: boolean;
}
