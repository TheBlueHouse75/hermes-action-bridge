import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { BridgeConfig } from "./types.js";

const modeSchema = z.enum(["plan", "draft", "execute", "request-approval"]);
const riskSchema = z.enum([
  "publish_external",
  "send_message",
  "send_email",
  "delete",
  "payment",
  "git_push",
  "credential_change",
]);

const rawConfigSchema = z.object({
  runtime: z
    .object({
      adapter: z.literal("hermes-cli").default("hermes-cli"),
      command: z.string().min(1).default("hermes"),
    })
    .default({ adapter: "hermes-cli", command: "hermes" }),
  defaults: z
    .object({
      mode: modeSchema.default("plan"),
      profile: z.string().min(1).optional(),
      source: z.string().min(1).default("external-agent"),
      max_turns: z.number().int().positive().default(30),
      preset: z.string().min(1).default("default"),
    })
    .default({ mode: "plan", source: "external-agent", max_turns: 30, preset: "default" }),
  presets: z
    .record(
      z.string(),
      z.object({
        description: z.string().optional(),
        skills: z.array(z.string()).default([]),
        toolsets: z.array(z.string()).default([]),
        provider: z.string().optional(),
        model: z.string().optional(),
        profile: z.string().optional(),
        max_turns: z.number().int().positive().optional(),
        source: z.string().optional(),
      }),
    )
    .default({ default: { skills: [], toolsets: [] } }),
  policy: z
    .object({
      yolo: z.boolean().default(false),
      require_approval_for: z.array(riskSchema).default([
        "publish_external",
        "send_message",
        "send_email",
        "delete",
        "payment",
        "git_push",
        "credential_change",
      ]),
    })
    .default({ yolo: false, require_approval_for: [] }),
});

type RawConfig = z.infer<typeof rawConfigSchema>;

export const defaultConfig: BridgeConfig = {
  runtime: { adapter: "hermes-cli", command: "hermes" },
  defaults: { mode: "plan", source: "external-agent", maxTurns: 30, preset: "default" },
  presets: { default: { skills: [], toolsets: [] } },
  policy: {
    yolo: false,
    requireApprovalFor: [
      "publish_external",
      "send_message",
      "send_email",
      "delete",
      "payment",
      "git_push",
      "credential_change",
    ],
  },
};

export function defaultProjectConfig(): string {
  return YAML.stringify({
    runtime: { adapter: "hermes-cli", command: "hermes" },
    defaults: { mode: "plan", source: "external-agent", max_turns: 30, preset: "default" },
    presets: {
      default: { description: "No extra skills or toolsets. Uses the active Hermes profile.", skills: [], toolsets: [] },
      research: { description: "General research and synthesis.", skills: [], toolsets: ["web", "terminal", "file"] },
      coding: { description: "Repository inspection and runtime validation.", skills: ["developer-assurance-and-validation", "runtime-debugging"], toolsets: ["terminal", "file"] },
    },
    policy: {
      yolo: false,
      require_approval_for: ["publish_external", "send_message", "send_email", "delete", "payment", "git_push", "credential_change"],
    },
  });
}

export function loadConfig(cwd = process.cwd(), explicitPath?: string): BridgeConfig {
  const paths = configPaths(cwd, explicitPath);
  const raws = paths.filter(existsSync).map((path) => readYaml(path));
  const merged = raws.reduce<Record<string, unknown>>((acc, item) => deepMerge(acc, item), structuredClone(toRaw(defaultConfig)));
  const parsed = rawConfigSchema.parse(merged);
  return normalizeConfig(parsed);
}

export function configPaths(cwd = process.cwd(), explicitPath?: string): string[] {
  if (explicitPath) return [resolve(cwd, explicitPath)];
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return [join(xdg, "hermes-action", "config.yaml"), join(cwd, ".hermes-action.yaml")];
}

function readYaml(path: string): Record<string, unknown> {
  const content = readFileSync(path, "utf8");
  const parsed = YAML.parse(content) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRaw(config: BridgeConfig): Record<string, unknown> {
  return {
    runtime: config.runtime,
    defaults: {
      mode: config.defaults.mode,
      profile: config.defaults.profile,
      source: config.defaults.source,
      max_turns: config.defaults.maxTurns,
      preset: config.defaults.preset,
    },
    presets: Object.fromEntries(
      Object.entries(config.presets).map(([name, preset]) => [
        name,
        {
          description: preset.description,
          skills: preset.skills,
          toolsets: preset.toolsets,
          provider: preset.provider,
          model: preset.model,
          profile: preset.profile,
          max_turns: preset.maxTurns,
          source: preset.source,
        },
      ]),
    ),
    policy: { yolo: config.policy.yolo, require_approval_for: config.policy.requireApprovalFor },
  };
}

function normalizeConfig(raw: RawConfig): BridgeConfig {
  return {
    runtime: raw.runtime,
    defaults: {
      mode: raw.defaults.mode,
      profile: raw.defaults.profile,
      source: raw.defaults.source,
      maxTurns: raw.defaults.max_turns,
      preset: raw.defaults.preset,
    },
    presets: Object.fromEntries(
      Object.entries(raw.presets).map(([name, preset]) => [
        name,
        {
          description: preset.description,
          skills: preset.skills,
          toolsets: preset.toolsets,
          provider: preset.provider,
          model: preset.model,
          profile: preset.profile,
          maxTurns: preset.max_turns,
          source: preset.source,
        },
      ]),
    ),
    policy: { yolo: raw.policy.yolo, requireApprovalFor: raw.policy.require_approval_for },
  };
}
