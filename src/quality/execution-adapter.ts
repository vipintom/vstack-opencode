/**
 * Verified process execution adapter.
 *
 * Runs a command without a shell, captures bounded stdout/stderr, and
 * reports a structured result. Never throws for process failures.
 */

import { spawn } from "node:child_process";

export interface ExecutionOptions {
  workingDirectory: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  environment?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export async function executeCommand(
  command: string[],
  options: ExecutionOptions
): Promise<ExecutionResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const [executable, ...args] = command;
  if (!executable) {
    return {
      exitCode: null,
      stdout: "",
      stderr: "No command provided",
      timedOut: false,
      cancelled: false,
      truncated: false,
      durationMs: Date.now() - startTime,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  return new Promise<ExecutionResult>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const child = spawn(executable, args, {
      cwd: options.workingDirectory,
      env: { ...process.env, ...options.environment },
      shell: false,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      const current = target === "stdout" ? stdout : stderr;
      if (current.length + text.length > maxOutputBytes) {
        const remaining = Math.max(0, maxOutputBytes - current.length);
        const slice = text.slice(0, remaining);
        if (target === "stdout") stdout += slice;
        else stderr += slice;
        truncated = true;
        return;
      }
      if (target === "stdout") stdout += text;
      else stderr += text;
    };

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));

    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise({
        exitCode,
        stdout,
        stderr,
        timedOut,
        cancelled,
        truncated,
        durationMs: Date.now() - startTime,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    };

    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      settle(null);
    });

    child.on("close", (code) => settle(code));
  });
}
