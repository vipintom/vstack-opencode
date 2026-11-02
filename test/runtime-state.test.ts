import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createTestWorkspace, TestWorkspace } from "./helpers.js";
import { initializeRuntimeState, refreshRuntimeState } from "../src/runtime/state.js";
import { createLifecycleEngine } from "../src/lifecycle/lifecycle-engine.js";

let workspace: TestWorkspace;

afterEach(() => workspace?.cleanup());

describe("runtime state", () => {
  it("creates a manifest and initial dashboard index", async () => {
    workspace = await createTestWorkspace();

    const index = await initializeRuntimeState(workspace.paths);

    expect(existsSync(workspace.paths.manifest)).toBe(true);
    expect(existsSync(workspace.paths.index)).toBe(true);
    expect(index.revision).toBe(1);
    expect(index.activeDeliveries).toEqual([]);
  });

  it("increments the index revision when an active delivery appears", async () => {
    workspace = await createTestWorkspace();
    await initializeRuntimeState(workspace.paths);
    const engine = await createLifecycleEngine(workspace.paths);

    const delivery = await engine.createDelivery({
      title: "Add login",
      description: "Add login flow",
      type: "feature",
      profile: "feature",
      acceptanceCriteria: ["User can log in"],
      risk: "low",
      labels: [],
      createdBy: "test",
    });
    await engine.startDelivery(delivery.id, "test", "agent");

    const index = await refreshRuntimeState(workspace.paths);
    const stored = JSON.parse(readFileSync(workspace.paths.index, "utf-8"));

    expect(index.revision).toBe(2);
    expect(stored.revision).toBe(2);
    expect(stored.activeDeliveries.map((d: { id: string }) => d.id)).toContain(delivery.id);
  });

  it("keeps the revision stable when nothing changed", async () => {
    workspace = await createTestWorkspace();
    const first = await initializeRuntimeState(workspace.paths);

    const second = await refreshRuntimeState(workspace.paths);

    expect(second.revision).toBe(first.revision);
  });
});
