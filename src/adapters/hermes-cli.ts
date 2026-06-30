import { spawn } from "node:child_process";
import type { AdapterResult, BridgeConfig, EffectiveRun } from "../types.js";
import { buildHermesPrompt } from "../prompt.js";

/** Grace period between SIGTERM and SIGKILL when a run exceeds its timeout. */
const killGraceMs = 2000;
/** A delay past the 32-bit signed-int limit makes setTimeout fire immediately; clamp so a huge timeout never kills the run on startup. */
const maxTimeoutMs = 2_147_483_647;

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
    const promptBytes = Buffer.byteLength(prompt, "utf8");
    const stdout = JSON.stringify({ command, prompt, promptBytes, promptChars: prompt.length }, null, 2);
    return { ok: true, exitCode: 0, stdout, stderr: "", command, prompt, dryRun: true };
  }

  return new Promise((resolve) => {
    const child = spawn(config.runtime.command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = Math.min(run.timeoutSeconds * 1000, maxTimeoutMs);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    }, timeoutMs);
    const clearTimers = () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimers();
      resolve({ ok: false, exitCode: 127, stdout, stderr: `${stderr}${error.message}`, command, prompt, dryRun: false });
    });
    child.on("close", (code) => {
      clearTimers();
      if (timedOut) {
        const message = `Hermes timed out after ${run.timeoutSeconds}s and was terminated.`;
        resolve({ ok: false, exitCode: code ?? 124, stdout, stderr: stderr ? `${stderr}\n${message}` : message, command, prompt, dryRun: false, timedOut: true });
        return;
      }
      const exitCode = code ?? 1;
      resolve({ ok: exitCode === 0, exitCode, stdout, stderr, command, prompt, dryRun: false });
    });
  });
}
