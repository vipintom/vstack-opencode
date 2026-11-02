import { afterEach, describe, expect, it } from "vitest";
import { createTestWorkspace, TestWorkspace } from "./helpers.js";
import { createEvidenceLedger } from "../src/quality/evidence-ledger.js";

let workspace: TestWorkspace;

afterEach(() => workspace?.cleanup());

describe("evidence ledger", () => {
  it("stores an evidence record and returns its id", async () => {
    workspace = await createTestWorkspace();
    const ledger = await createEvidenceLedger(workspace.paths);

    const evidence = await ledger.record({
      deliveryId: "del_test",
      type: "build",
      source: "plugin_execution",
      checkId: "build",
      command: ["pnpm", "run", "build"],
      workingDirectory: workspace.root,
      commitRef: "abc123",
      status: "passed",
      summary: "Build succeeded",
      executionId: "exec_1",
    });

    expect(evidence.id).toMatch(/^evd_/);
    expect(evidence.status).toBe("passed");
    expect(evidence.startedAt).toBeTruthy();
    expect(evidence.completedAt).toBeTruthy();
  });

  it("lists evidence for a delivery", async () => {
    workspace = await createTestWorkspace();
    const ledger = await createEvidenceLedger(workspace.paths);

    await ledger.record({
      deliveryId: "del_test",
      type: "lint",
      source: "plugin_execution",
      checkId: "lint",
      command: ["pnpm", "run", "lint"],
      workingDirectory: workspace.root,
      commitRef: "abc123",
      status: "failed",
      summary: "Lint failed",
      executionId: "exec_2",
    });

    const records = await ledger.list("del_test");

    expect(records).toHaveLength(1);
    expect(records[0]?.checkId).toBe("lint");
    expect(records[0]?.status).toBe("failed");
  });

  it("filters evidence by status", async () => {
    workspace = await createTestWorkspace();
    const ledger = await createEvidenceLedger(workspace.paths);

    for (const status of ["passed", "failed"] as const) {
      await ledger.record({
        deliveryId: "del_test",
        type: "build",
        source: "plugin_execution",
        checkId: "build",
        command: ["pnpm", "run", "build"],
        workingDirectory: workspace.root,
        commitRef: "abc123",
        status,
        summary: `Build ${status}`,
        executionId: `exec_${status}`,
      });
    }

    const passed = await ledger.list("del_test", { status: ["passed"] });

    expect(passed).toHaveLength(1);
    expect(passed[0]?.status).toBe("passed");
  });

  it("stores stdout and stderr output on disk", async () => {
    workspace = await createTestWorkspace();
    const ledger = await createEvidenceLedger(workspace.paths);

    const evidence = await ledger.record({
      deliveryId: "del_test",
      type: "test:unit",
      source: "plugin_execution",
      checkId: "test:unit",
      command: ["pnpm", "test"],
      workingDirectory: workspace.root,
      commitRef: "abc123",
      status: "passed",
      summary: "Tests passed",
      executionId: "exec_3",
      stdout: "5 tests passed",
      stderr: "",
    });

    expect(evidence.stdoutPath).toBeTruthy();
    const listed = await ledger.list("del_test");
    expect(listed[0]?.stdoutPath).toBe(evidence.stdoutPath);
  });
});
