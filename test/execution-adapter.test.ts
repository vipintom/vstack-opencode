import { describe, expect, it } from "vitest";
import { executeCommand } from "../src/quality/execution-adapter.js";

describe("execution adapter", () => {
  it("captures stdout, stderr and exit code", async () => {
    const result = await executeCommand(
      ["node", "-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"],
      { workingDirectory: process.cwd() }
    );

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports success for a zero exit code", async () => {
    const result = await executeCommand(["node", "-e", "process.exit(0)"], {
      workingDirectory: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
  });

  it("kills the process on timeout", async () => {
    const result = await executeCommand(["node", "-e", "setTimeout(() => {}, 10000)"], {
      workingDirectory: process.cwd(),
      timeoutMs: 300,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it("bounds captured output", async () => {
    const result = await executeCommand(
      ["node", "-e", "process.stdout.write('x'.repeat(5000))"],
      { workingDirectory: process.cwd(), maxOutputBytes: 100 }
    );

    expect(result.stdout.length).toBeLessThanOrEqual(100);
    expect(result.truncated).toBe(true);
  });

  it("reports a spawn failure without throwing", async () => {
    const result = await executeCommand(["vstack-command-that-does-not-exist"], {
      workingDirectory: process.cwd(),
    });

    expect(result.exitCode).toBeNull();
    expect(result.stderr).toContain("ENOENT");
  });

  it("stops when the abort signal fires", async () => {
    const controller = new AbortController();
    const promise = executeCommand(["node", "-e", "setTimeout(() => {}, 10000)"], {
      workingDirectory: process.cwd(),
      signal: controller.signal,
    });
    controller.abort();

    const result = await promise;

    expect(result.cancelled).toBe(true);
  });
});
