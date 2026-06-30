import { spawn } from "node:child_process";
import type { AdapterResult, BridgeConfig, EffectiveRun } from "../types.js";
import { buildHermesPrompt } from "../prompt.js";

export function buildHermesCliArgs(run: EffectiveRun, prompt: string = buildHermesPrompt(run)): string[] {
  const args = ["chat", "-Q", "--source", run.source, "--max-turns", String(run.maxTurns)];
  if (run.profile) args.unshift("--profile", run.profile);
  if (run.provider) args.push("--provider", run.provider);
  if (run.model) args.push("--model", run.model);
  if (run.preset.skills.length) args.push("--skills", run.preset.skills.join(","));
  if (run.preset.toolsets.length) args.push("--toolsets", run.preset.toolsets.join(","));
  if (run.yolo) args.push("--yolo");
  args.push("-q", prompt);
  return args;
}

export async function runHermesCli(config: BridgeConfig, run: EffectiveRun, dryRun: boolean): Promise<AdapterResult> {
  const prompt = buildHermesPrompt(run);
  const args = buildHermesCliArgs(run, prompt);
  const command = [config.runtime.command, ...args];
  if (dryRun) {
    return { ok: true, exitCode: 0, stdout: JSON.stringify({ command, prompt }, null, 2), stderr: "", command, prompt, dryRun: true };
  }

  return new Promise((resolve) => {
    const child = spawn(config.runtime.command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ ok: false, exitCode: 127, stdout, stderr: `${stderr}${error.message}`, command, prompt, dryRun: false });
    });
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      resolve({ ok: exitCode === 0, exitCode, stdout, stderr, command, prompt, dryRun: false });
    });
  });
}
