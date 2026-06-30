import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterResult, BridgeConfig, EffectiveRun } from "../types.js";
import { buildHermesPrompt } from "../prompt.js";

/** Grace period between SIGTERM and SIGKILL when a run exceeds its timeout. */
const killGraceMs = 2000;
/** A delay past the 32-bit signed-int limit makes setTimeout fire immediately; clamp so a huge timeout never kills the run on startup. */
const maxTimeoutMs = 2_147_483_647;
/**
 * ~896 KiB: above this the envelope risks E2BIG as a `-q` argv, so deliver it via a temp file the child
 * reads itself. Sits below the ~1 MiB ARG_MAX. The default context budget (~768 KiB) keeps envelopes
 * under this, so the temp-file path is opt-in — reached only when runtime.max_context_bytes is raised.
 */
const largePromptThresholdBytes = 917_504;

export function buildHermesCliArgs(
  run: EffectiveRun,
  prompt: string = buildHermesPrompt(run),
  extraToolsets: string[] = [],
): string[] {
  const args = ["chat", "-Q", "--source", run.source, "--max-turns", String(run.maxTurns)];
  if (run.profile) args.unshift("--profile", run.profile);
  if (run.provider) args.push("--provider", run.provider);
  if (run.model) args.push("--model", run.model);
  if (run.preset.skills.length) args.push("--skills", run.preset.skills.join(","));
  const toolsets = [...new Set([...run.preset.toolsets, ...extraToolsets])];
  if (toolsets.length) args.push("--toolsets", toolsets.join(","));
  if (run.yolo) args.push("--yolo");
  args.push("-q", prompt);
  return args;
}

/** Short query that points Hermes at the file holding the full envelope (used for the large-payload path). */
function filePointerPrompt(path: string): string {
  return [
    "Your full instructions, the user's request, and all context are in this file:",
    path,
    "Read it completely with your file tool before doing anything, then follow the instructions inside it.",
    "Never reveal secrets.",
  ].join("\n");
}

export async function runHermesCli(config: BridgeConfig, run: EffectiveRun, dryRun: boolean): Promise<AdapterResult> {
  const prompt = buildHermesPrompt(run);
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  const isLarge = promptBytes > largePromptThresholdBytes;

  if (dryRun) {
    const args = isLarge ? buildHermesCliArgs(run, filePointerPrompt("<temp-file>"), ["file"]) : buildHermesCliArgs(run, prompt);
    const command = [config.runtime.command, ...args];
    const stdout = JSON.stringify({ command, prompt, promptBytes, promptChars: prompt.length, delivery: isLarge ? "temp-file" : "argv" }, null, 2);
    return { ok: true, exitCode: 0, stdout, stderr: "", command, prompt, dryRun: true };
  }

  // Large envelopes can't ride argv (E2BIG); write them to a secure temp file the child reads itself.
  // tmpDir is set only after a successful write so a failed write cleans up and never leaks an empty dir.
  let tmpDir: string | undefined;
  const args = ((): string[] => {
    if (!isLarge) return buildHermesCliArgs(run, prompt);
    const dir = mkdtempSync(join(tmpdir(), "hermes-action-bridge-"));
    try {
      const promptFile = join(dir, "prompt.md");
      writeFileSync(promptFile, prompt, { mode: 0o600 });
      // Inject "file" so Hermes can read the temp file even when the preset declares no file-capable toolset.
      const built = buildHermesCliArgs(run, filePointerPrompt(promptFile), ["file"]);
      tmpDir = dir;
      return built;
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  })();
  const command = [config.runtime.command, ...args];

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
    // 'error' and 'close' can both fire (e.g. spawn ENOENT); guard so cleanup and resolve run exactly once.
    // The temp file is removed here on every settle path. Only an uncatchable SIGKILL of the bridge itself
    // would leave it behind; mkdtemp + 0600 + the OS temp reaper bound that residual risk.
    let settled = false;
    const settle = (result: AdapterResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (tmpDir) {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup */
        }
      }
      resolve(result);
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
      settle({ ok: false, exitCode: 127, stdout, stderr: `${stderr}${error.message}`, command, prompt, dryRun: false });
    });
    child.on("close", (code) => {
      if (timedOut) {
        const message = `Hermes timed out after ${run.timeoutSeconds}s and was terminated.`;
        settle({ ok: false, exitCode: code ?? 124, stdout, stderr: stderr ? `${stderr}\n${message}` : message, command, prompt, dryRun: false, timedOut: true });
        return;
      }
      const exitCode = code ?? 1;
      settle({ ok: exitCode === 0, exitCode, stdout, stderr, command, prompt, dryRun: false });
    });
  });
}
