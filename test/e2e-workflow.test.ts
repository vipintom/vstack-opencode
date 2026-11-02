/**
 * E2E Workflow Test
 * 
 * Tests a complete feature delivery workflow:
 * 1. Create delivery
 * 2. Create tasks with dependencies
 * 3. Dispatch agents
 * 4. Execute checks and record evidence
 * 5. Verify completion requirements
 * 6. Publish projections for OpenChamber
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { createMemoryStore } from "../src/memory/memory-store.js";
import { createDeliveryStore } from "../src/deliveries/delivery-store.js";
import { createTaskStore } from "../src/tasks/task-store.js";
import { createAgentRunStore } from "../src/agents/agent-run-store.js";
import { createHistoryService } from "../src/history/history-service.js";
import { createCheckService } from "../src/quality/check-service.js";
import { createEnforcementService } from "../src/enforcement/enforcement-service.js";
import { createAgentDispatch } from "../src/orchestration/agent-dispatch.js";
import { publishProjections } from "../src/dashboard/projection-publisher.js";
import { VstackPaths, ensureVstackDirs } from "../src/persistence/repository-root.js";
import { initializeEventLog } from "../src/persistence/event-log.js";
import { existsSync, rmSync } from "node:fs";

const TEST_VSTACK_ROOT = resolve("/tmp", "vstack-e2e-test");

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

describe("E2E Feature Delivery Workflow", () => {
  let paths: VstackPaths;
  let memoryStore: ReturnType<typeof createMemoryStore>;
  let deliveryStore: ReturnType<typeof createDeliveryStore>;
  let taskStore: ReturnType<typeof createTaskStore>;
  let agentRunStore: ReturnType<typeof createAgentRunStore>;
  let historyService: ReturnType<typeof createHistoryService>;
  let checkService: ReturnType<typeof createCheckService>;
  let enforcementService: ReturnType<typeof createEnforcementService>;
  let agentDispatch: ReturnType<typeof createAgentDispatch>;

  beforeEach(async () => {
    await cleanupTestRoot();
    paths = createTestVstackPaths();
    await ensureVstackDirs(paths);
    await initializeEventLog(paths);

    memoryStore = await createMemoryStore(paths);
    deliveryStore = await createDeliveryStore(paths);
    taskStore = await createTaskStore(paths);
    agentRunStore = await createAgentRunStore(paths);
    historyService = await createHistoryService(paths);
    checkService = await createCheckService(paths);
    enforcementService = await createEnforcementService(paths);
    agentDispatch = await createAgentDispatch(paths, {
      defaultModel: null,
      maxSteps: { default: 50 },
      defaultPermissions: ["read", "glob", "grep", "edit", "shell", "tool", "subagent", "skill"],
      enableWorktrees: false,
    }, {} as any);
  });

  it("should complete a full feature delivery workflow", async () => {
    // Step 1: Create delivery
    const delivery = await deliveryStore.createDelivery({
      title: "Add user authentication",
      objective: "Implement JWT-based authentication for API endpoints",
      type: "feature",
      acceptanceCriteria: [
        "Users can register with email/password",
        "Users can login and receive JWT token",
        "Protected endpoints require valid JWT",
        "Tokens expire after 24 hours"
      ],
      risk: "medium",
      labels: ["auth", "api", "security"],
      createdBy: "vstack-lead",
    });
    expect(delivery.id).toBeDefined();
    expect(delivery.status).toBe("active");

    // Step 2: Create tasks with dependencies
    const task1 = await taskStore.createTask({
      deliveryId: delivery.id,
      title: "Design auth schema and JWT structure",
      description: "Define database schema for users and JWT token format",
      type: "design",
      priority: "high",
      dependencies: [],
      acceptanceCriteria: ["User schema defined", "JWT payload structure documented"],
      expectedOutputs: ["schema.sql", "jwt-design.md"],
      requiredSkills: ["vstack-blueprint", "vstack-blast-radius"],
      workScope: "docs/architecture/auth.md",
      worktreePath: null,
      maxAttempts: 3,
      assignedAgentId: null,
    });

    const task2 = await taskStore.createTask({
      deliveryId: delivery.id,
      title: "Implement user registration endpoint",
      description: "Create POST /auth/register with password hashing",
      type: "implementation",
      priority: "high",
      dependencies: [task1.id],
      acceptanceCriteria: ["Endpoint accepts email/password", "Password hashed with bcrypt", "User saved to database"],
      expectedOutputs: ["src/auth/register.ts", "tests/register.test.ts"],
      requiredSkills: ["vstack-tdd", "vstack-verify-loop"],
      workScope: "src/auth/",
      worktreePath: null,
      maxAttempts: 3,
      assignedAgentId: null,
    });

    const task3 = await taskStore.createTask({
      deliveryId: delivery.id,
      title: "Implement login and JWT generation",
      description: "Create POST /auth/login returning JWT token",
      type: "implementation",
      priority: "high",
      dependencies: [task1.id],
      acceptanceCriteria: ["Endpoint validates credentials", "Returns JWT on success", "Token expires in 24h"],
      expectedOutputs: ["src/auth/login.ts", "tests/login.test.ts"],
      requiredSkills: ["vstack-tdd", "vstack-verify-loop"],
      workScope: "src/auth/",
      worktreePath: null,
      maxAttempts: 3,
      assignedAgentId: null,
    });

    const task4 = await taskStore.createTask({
      deliveryId: delivery.id,
      title: "Add JWT middleware for protected routes",
      description: "Create middleware to validate JWT on protected endpoints",
      type: "implementation",
      priority: "high",
      dependencies: [task2.id, task3.id],
      acceptanceCriteria: ["Middleware validates JWT signature", "Rejects expired tokens", "Attaches user to request"],
      expectedOutputs: ["src/auth/jwt-middleware.ts", "tests/jwt-middleware.test.ts"],
      requiredSkills: ["vstack-tdd", "vstack-verify-loop"],
      workScope: "src/auth/",
      worktreePath: null,
      maxAttempts: 3,
      assignedAgentId: null,
    });

    const task5 = await taskStore.createTask({
      deliveryId: delivery.id,
      title: "Write integration tests and documentation",
      description: "Test full auth flow and write API docs",
      type: "testing",
      priority: "medium",
      dependencies: [task4.id],
      acceptanceCriteria: ["Full auth flow tested", "API docs updated", "README updated"],
      expectedOutputs: ["tests/integration.test.ts", "docs/api.md"],
      requiredSkills: ["vstack-verify-loop", "vstack-lessons"],
      workScope: "tests/, docs/",
      worktreePath: null,
      maxAttempts: 2,
      assignedAgentId: null,
    });

    // Verify all tasks created
    const allTasks = await taskStore.listTasks(delivery.id);
    expect(allTasks).toHaveLength(5);

    // Verify dependencies and ready tasks
    const readyTasks = await taskStore.getReadyTasks(delivery.id);
    expect(readyTasks).toHaveLength(1);
    expect(readyTasks[0].id).toBe(task1.id);

    // Step 3: Simulate agent work on tasks
    // Task 1: Design
    await taskStore.updateTask(task1.id, { status: "ready", assignedAgentId: "vstack-builder" });
    await taskStore.updateTask(task1.id, { status: "in_progress" });
    await taskStore.updateTask(task1.id, { 
      status: "completed", 
      resultSummary: "Auth schema and JWT design completed",
      evidenceIds: ["evd-1"]
    });

    // Task 2 & 3 can now start (depend on task1)
    const readyAfterTask1 = await taskStore.getReadyTasks(delivery.id);
    expect(readyAfterTask1).toHaveLength(2);

    // Simulate agent dispatch for task 2
    const dispatchResult2 = await agentDispatch.dispatchAgent({
      delivery,
      task: await taskStore.getTask(task2.id)!,
      agentId: "vstack-builder",
      worktreePath: null,
      customPrompt: "Implement user registration endpoint",
      contextFiles: ["docs/architecture/auth.md"],
    });
    expect(dispatchResult2.status).toBe("created");

    // Update task 2 as in progress
    await taskStore.updateTask(task2.id, { status: "ready", assignedAgentId: "vstack-builder" });
    await taskStore.updateTask(task2.id, { status: "in_progress" });

    // Simulate check execution for task 2
    const checkResult2 = await checkService.executeCheck({
      deliveryId: delivery.id,
      taskId: task2.id,
      agentRunId: dispatchResult2.agentRunId,
      checkId: "test:unit",
      command: ["echo", "success"],
      workingDirectory: "/tmp",
      commitRef: "abc123",
      timeoutMs: 30000,
      sessionId: dispatchResult2.sessionId,
    });
    expect(checkResult2.evidence.status).toBe("passed");

    // Complete task 2
    await taskStore.updateTask(task2.id, { 
      status: "completed", 
      resultSummary: "Registration endpoint implemented and tested",
      evidenceIds: [checkResult2.evidence.id]
    });

    // Complete task 3 similarly
    await taskStore.updateTask(task3.id, { status: "ready", assignedAgentId: "vstack-builder" });
    await taskStore.updateTask(task3.id, { status: "in_progress" });
    await taskStore.updateTask(task3.id, { 
      status: "completed", 
      resultSummary: "Login and JWT generation implemented",
      evidenceIds: ["evd-3"]
    });

    // Task 4 now ready
    const readyAfter2And3 = await taskStore.getReadyTasks(delivery.id);
    expect(readyAfter2And3).toHaveLength(1);
    expect(readyAfter2And3[0].id).toBe(task4.id);

    // Complete task 4
    await taskStore.updateTask(task4.id, { status: "ready", assignedAgentId: "vstack-builder" });
    await taskStore.updateTask(task4.id, { status: "in_progress" });
    await taskStore.updateTask(task4.id, { 
      status: "completed", 
      resultSummary: "JWT middleware implemented",
      evidenceIds: ["evd-4"]
    });

    // Task 5 now ready
    const readyAfter4 = await taskStore.getReadyTasks(delivery.id);
    expect(readyAfter4).toHaveLength(1);
    expect(readyAfter4[0].id).toBe(task5.id);

    // Complete task 5
    await taskStore.updateTask(task5.id, { status: "ready", assignedAgentId: "vstack-builder" });
    await taskStore.updateTask(task5.id, { status: "in_progress" });
    await taskStore.updateTask(task5.id, { 
      status: "completed", 
      resultSummary: "Integration tests and docs completed",
      evidenceIds: ["evd-5"]
    });

    // Step 4: Verify all tasks completed
    const allTasksFinal = await taskStore.listTasks(delivery.id);
    const completedTasks = allTasksFinal.filter(t => t.status === "completed");
    expect(completedTasks).toHaveLength(5);

    // Step 5: Check enforcement - delivery should be completable
    const enforcement = await enforcementService.canCompleteDelivery(delivery.id);
    expect(enforcement.allowed).toBe(true);
    expect(enforcement.reasons).toHaveLength(0);

    // Verify dashboard index before completing delivery (dashboard shows active only)
    const { refreshDashboardIndex } = await import("../src/dashboard/index-generator.js");
    const { loadDeliveries: loadDeliveriesProjections } = await import("../src/dashboard/projections/loaders.js");
    const loadedDeliveries = await loadDeliveriesProjections(paths);
    console.log("Loaded deliveries:", loadedDeliveries.map(d => ({id: d.id, status: d.status})));
    const dashboardIndex = await refreshDashboardIndex(paths);
    console.log("Dashboard index:", dashboardIndex);
    expect(dashboardIndex.activeDeliveries).toHaveLength(1);
    expect(dashboardIndex.activeDeliveries[0].id).toBe(delivery.id);

    // Complete delivery
    await deliveryStore.updateDelivery(delivery.id, { status: "completed" });

    // Step 6: Record memory
    await memoryStore.createItem("architecture", {
      title: "Auth System Design",
      content: "JWT-based auth with 24h expiry, bcrypt password hashing",
      source: delivery.id,
      tags: ["auth", "jwt", "security"],
    });

    await memoryStore.createItem("lessons", {
      title: "JWT Middleware Pattern",
      content: "Extract token from Authorization header, validate with jose library",
      source: delivery.id,
      tags: ["jwt", "middleware", "pattern"],
    });

    // Step 6: Verify history
    const history = await historyService.getDeliveryHistory(delivery.id);
    expect(history.length).toBeGreaterThan(0);

    // Step 7: Dispatch reviewer
    const dispatchResultReviewer = await agentDispatch.dispatchAgent({
      delivery,
      task: { ...allTasksFinal[4], id: task5.id } as any,
      agentId: "vstack-reviewer",
      worktreePath: null,
      customPrompt: "Review auth implementation for security and correctness",
      contextFiles: ["docs/architecture/auth.md", "src/auth/"],
    });
    expect(dispatchResultReviewer.status).toBe("created");

    // Step 7: Publish projections for OpenChamber
    console.log("Publishing projections...");
    await publishProjections(paths);
    console.log("Projections published");

    // Verify projections created
    const { readJsonFile } = await import("../src/persistence/file-store.js");
    
    // Debug: check what's in reports directory
    const { listDirs } = await import("../src/persistence/file-store.js");
    const reportDirs = listDirs(paths, paths.reports);
    console.log("Report dirs:", reportDirs);
    
    const deliveryReport = await readJsonFile(paths, resolve(paths.reports, "deliveries", `${delivery.id}.json`));
    console.log("Delivery report:", deliveryReport ? "found" : "null");
    expect(deliveryReport).toBeDefined();
    expect(deliveryReport.delivery.id).toBe(delivery.id);
    expect(deliveryReport.tasks).toHaveLength(5);

    const activityReport = await readJsonFile(paths, resolve(paths.reports, "activity", `${delivery.id}.json`));
    expect(activityReport).toBeDefined();
    expect(activityReport.activities.length).toBeGreaterThan(0);

    const memoryIndexReport = await readJsonFile(paths, resolve(paths.reports, "memory-index.json"));
    expect(memoryIndexReport).toBeDefined();
    expect(memoryIndexReport.categories.architecture).toBeDefined();
    expect(memoryIndexReport.categories.lessons).toBeDefined();

    const qualityReport = await readJsonFile(paths, resolve(paths.reports, "quality", `${delivery.id}.json`));
    expect(qualityReport).toBeDefined();
    expect(qualityReport.checksTotal).toBeGreaterThan(0);
  });
});
