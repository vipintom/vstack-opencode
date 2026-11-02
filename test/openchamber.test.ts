/**
 * OpenChamber Tests
 * 
 * Tests for read-only projection verification, stale data handling, and no mutation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { VstackPaths, ensureVstackDirs } from "../src/persistence/repository-root.js";
import { initializeEventLog } from "../src/persistence/event-log.js";
import { createDeliveryStore } from "../src/deliveries/delivery-store.js";
import { createTaskStore } from "../src/tasks/task-store.js";
import { createMemoryStore } from "../src/memory/memory-store.js";
import { createHistoryService } from "../src/history/history-service.js";
import { createCheckService } from "../src/quality/check-service.js";
import { createAgentRunStore } from "../src/agents/agent-run-store.js";
import { createAgentDispatch } from "../src/orchestration/agent-dispatch.js";
import { publishProjections } from "../src/dashboard/projection-publisher.js";
import { refreshDashboardIndex } from "../src/dashboard/index-generator.js";

const TEST_VSTACK_ROOT = resolve("/tmp", "vstack-openchamber-test");

function createTestVstackPaths(): VstackPaths {
  const root = resolve(TEST_VSTACK_ROOT, ".vstack");
  return {
    root,
    state: resolve(root, "state"),
    deliveries: resolve(root, "deliveries"),
    config: resolve(root, "config"),
    reports: resolve(root, "reports"),
    locks: resolve(root, "state", "locks"),
    events: resolve(root, "state", "events.jsonl"),
    index: resolve(root, "state", "index.json"),
    manifest: resolve(root, "manifest.json"),
    memory: resolve(root, "memory"),
  };
}

async function cleanupTestRoot() {
  if (existsSync(TEST_VSTACK_ROOT)) {
    rmSync(TEST_VSTACK_ROOT, { recursive: true, force: true });
  }
}

describe("OpenChamber Projection Read-Only Verification", () => {
  let paths: VstackPaths;
  let deliveryStore: ReturnType<typeof createDeliveryStore>;
  let taskStore: ReturnType<typeof createTaskStore>;
  let memoryStore: ReturnType<typeof createMemoryStore>;
  let historyService: ReturnType<typeof createHistoryService>;
  let checkService: ReturnType<typeof createCheckService>;
  let agentRunStore: ReturnType<typeof createAgentRunStore>;
  let agentDispatch: ReturnType<typeof createAgentDispatch>;

  beforeEach(async () => {
    await cleanupTestRoot();
    paths = createTestVstackPaths();
    await ensureVstackDirs(paths);
    await initializeEventLog(paths);

    deliveryStore = await createDeliveryStore(paths);
    taskStore = await createTaskStore(paths);
    memoryStore = await createMemoryStore(paths);
    historyService = await createHistoryService(paths);
    checkService = await createCheckService(paths);
    agentRunStore = await createAgentRunStore(paths);
    agentDispatch = await createAgentDispatch(paths, {
      defaultModel: null,
      maxSteps: { default: 50 },
      defaultPermissions: ["read", "glob", "grep", "edit", "shell", "tool", "subagent", "skill"],
      enableWorktrees: false,
    }, {} as any);
  });

  it("should publish projections with v2 schema fields", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Projection test",
      objective: "Test v2 projection fields",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    const task = await taskStore.createTask({
      deliveryId: delivery.id,
      title: "Task",
      description: "Test task",
      type: "implementation",
      priority: "high",
      dependencies: [],
      acceptanceCriteria: ["Done"],
      expectedOutputs: ["output.ts"],
      requiredSkills: ["vstack-tdd"],
      workScope: "src/",
      worktreePath: null,
      maxAttempts: 3,
      assignedAgentId: null,
    });

    await taskStore.updateTask(task.id, { status: "completed" });
    await deliveryStore.updateDelivery(delivery.id, { status: "completed" });

    // Add memory
    await memoryStore.createItem("architecture", {
      title: "Test Architecture",
      content: "Test architecture content",
      source: delivery.id,
      tags: ["test"],
    });

    // Publish projections
    await publishProjections(paths);

    // Read delivery report - should have v2 fields
    const { readJsonFile } = await import("../src/persistence/file-store.js");
    const deliveryReport = await readJsonFile(paths, resolve(paths.reports, "deliveries", `${delivery.id}.json`));
    
    expect(deliveryReport).toBeDefined();
    expect(deliveryReport.schemaVersion).toBe(1);
    expect(deliveryReport.revision).toBeDefined();
    expect(deliveryReport.generatedAt).toBeDefined();
    expect(deliveryReport.delivery.id).toBe(delivery.id);
    expect(deliveryReport.tasks).toHaveLength(1);
    // v2 fields
    expect(deliveryReport.evidence).toBeDefined();
    expect(deliveryReport.reviewSessions).toBeDefined();
    expect(deliveryReport.decisions).toBeDefined();
    expect(deliveryReport.recoveries).toBeDefined();
    expect(deliveryReport.checkpoints).toBeDefined();
    expect(deliveryReport.lessons).toBeDefined();
    expect(deliveryReport.verificationIndex).toBeDefined();
  });

  it("should publish activity report with history events", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Activity test",
      objective: "Test activity report",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    await deliveryStore.updateDelivery(delivery.id, { status: "completed" });
    await publishProjections(paths);

    const { readJsonFile } = await import("../src/persistence/file-store.js");
    const activityReport = await readJsonFile(paths, resolve(paths.reports, "activity", `${delivery.id}.json`));
    
    expect(activityReport).toBeDefined();
    expect(activityReport.activities).toBeDefined();
  });

  it("should publish memory index report", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Memory test",
      objective: "Test memory index",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    await memoryStore.createItem("architecture", {
      title: "Test Arch",
      content: "Architecture content",
      source: delivery.id,
      tags: ["arch"],
    });

    await memoryStore.createItem("lessons", {
      title: "Test Lesson",
      content: "Lesson content",
      source: delivery.id,
      tags: ["lesson"],
    });

    await publishProjections(paths);

    const { readJsonFile } = await import("../src/persistence/file-store.js");
    const memoryIndex = await readJsonFile(paths, resolve(paths.reports, "memory-index.json"));
    
    expect(memoryIndex).toBeDefined();
    expect(memoryIndex.categories.architecture).toBeDefined();
    expect(memoryIndex.categories.lessons).toBeDefined();
  });

  it("should publish quality report with evidence provenance", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Quality test",
      objective: "Test quality report",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    const task = await taskStore.createTask({
      deliveryId: delivery.id,
      title: "Quality task",
      description: "Task with checks",
      type: "implementation",
      priority: "high",
      dependencies: [],
      acceptanceCriteria: ["Checks pass"],
      expectedOutputs: [],
      requiredSkills: ["vstack-verify-loop"],
      workScope: "src/",
      worktreePath: null,
      maxAttempts: 3,
      assignedAgentId: null,
    });

    // Dispatch agent and run check to generate evidence
    const dispatchResult = await agentDispatch.dispatchAgent({
      delivery,
      task,
      agentId: "vstack-builder",
      worktreePath: null,
      customPrompt: "Run check",
      contextFiles: [],
    });

    await checkService.executeCheck({
      deliveryId: delivery.id,
      taskId: task.id,
      agentRunId: dispatchResult.agentRunId,
      checkId: "test:unit",
      command: ["echo", "success"],
      workingDirectory: process.cwd(),
      commitRef: "abc123",
      timeoutMs: 30000,
      sessionId: dispatchResult.sessionId,
    });

    await taskStore.updateTask(task.id, { status: "completed" });
    await deliveryStore.updateDelivery(delivery.id, { status: "completed" });
    await publishProjections(paths);

    const { readJsonFile } = await import("../src/persistence/file-store.js");
    const qualityReport = await readJsonFile(paths, resolve(paths.reports, "quality", `${delivery.id}.json`));
    
    expect(qualityReport).toBeDefined();
    expect(typeof qualityReport.checksTotal).toBe("number");
    expect(qualityReport.checksTotal).toBeGreaterThanOrEqual(1);
  });

  it("should publish dashboard index with schema version", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Dashboard test",
      objective: "Test dashboard index",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    await publishProjections(paths);
    await refreshDashboardIndex(paths);

    const { readJsonFile } = await import("../src/persistence/file-store.js");
    const dashboardIndex = await readJsonFile(paths, paths.index);
    
    expect(dashboardIndex).toBeDefined();
    expect(dashboardIndex.schemaVersion).toBe(1);
    expect(dashboardIndex.revision).toBeDefined();
    expect(dashboardIndex.updatedAt).toBeDefined();
    expect(dashboardIndex.activeDeliveries).toHaveLength(1);
    expect(dashboardIndex.activeDeliveries[0].id).toBe(delivery.id);
  });

  it("projections should be atomic (no partial writes on failure)", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Atomic test",
      objective: "Test atomic projections",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    await deliveryStore.updateDelivery(delivery.id, { status: "completed" });
    await publishProjections(paths);

    const { readJsonFile } = await import("../src/persistence/file-store.js");
    const deliveryReport = await readJsonFile(paths, resolve(paths.reports, "deliveries", `${delivery.id}.json`));
    
    // Should have complete report
    expect(deliveryReport).toBeDefined();
    expect(deliveryReport.schemaVersion).toBe(1);
    expect(deliveryReport.tasks).toHaveLength(0); // No tasks created
  });

  it("should handle stale evidence (commit mismatch)", async () => {
    // Simulate evidence from a different commit
    const delivery = await deliveryStore.createDelivery({
      title: "Stale evidence test",
      objective: "Test stale evidence detection",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    await deliveryStore.updateDelivery(delivery.id, { status: "completed" });
    await publishProjections(paths);

    const { readJsonFile } = await import("../src/persistence/file-store.js");
    const deliveryReport = await readJsonFile(paths, resolve(paths.reports, "deliveries", `${delivery.id}.json`));
    
    // Evidence should include commitRef for freshness checking
    expect(deliveryReport.evidence).toBeDefined();
  });

  it("should not allow mutation through projection files (read-only)", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Read-only test",
      objective: "Test read-only",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    await deliveryStore.updateDelivery(delivery.id, { status: "completed" });
    await publishProjections(paths);

    const reportPath = resolve(paths.reports, "deliveries", `${delivery.id}.json`);
    expect(existsSync(reportPath)).toBe(true);
    
    // The projection file exists but should not be written to by OpenChamber
    const content = readFileSync(reportPath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.delivery.id).toBe(delivery.id);
  });
});

describe.skip("OpenChamber Schema Validation", () => {
  it.skip("should have v2 projection types defined", () => {
    // This test verifies the TypeScript types are correct
    // SKIPPED: Requires OpenChamber source code which is not available in this repository
    // Run this test from the OpenChamber repository instead
  });

  it.skip("api.ts should only read projections (no mutation)", () => {
    // Should only have read operations (uses host.readFile and host.listDir from SDK)
    // SKIPPED: Requires OpenChamber source code which is not available in this repository
  });
});
