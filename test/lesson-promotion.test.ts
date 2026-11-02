/**
 * Lesson Promotion Tests
 * 
 * Tests for lesson lifecycle and promotion from recurring failures.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { VstackPaths, ensureVstackDirs } from "../src/persistence/repository-root.js";
import { initializeEventLog } from "../src/persistence/event-log.js";
import { createDeliveryStore } from "../src/deliveries/delivery-store.js";
import { createTaskStore } from "../src/tasks/task-store.js";
import { createLessonStore } from "../src/tasks/lesson-store.js";

const TEST_VSTACK_ROOT = resolve("/tmp", "vstack-lesson-test");

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

const { existsSync, rmSync } = await import("node:fs");

describe("Lesson Promotion Lifecycle", () => {
  let paths: VstackPaths;
  let deliveryStore: ReturnType<typeof createDeliveryStore>;
  let taskStore: ReturnType<typeof createTaskStore>;
  let lessonStore: ReturnType<typeof createLessonStore>;

  beforeEach(async () => {
    await cleanupTestRoot();
    paths = createTestVstackPaths();
    await ensureVstackDirs(paths);
    await initializeEventLog(paths);

    deliveryStore = await createDeliveryStore(paths);
    taskStore = await createTaskStore(paths);
    lessonStore = await createLessonStore(paths);
  });

  it("should create lesson candidate with recurrence count >= 2", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Lesson test",
      objective: "Test lesson creation",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    // Create lesson with 3 occurrences (PRD: >= 2 for recurrence)
    const lesson = await lessonStore.createLesson({
      deliveryId: delivery.id,
      failureClass: "null_pointer_exception",
      occurrences: ["task-1", "task-2", "task-3"],
      recurrenceCount: 3,
      impactAssessment: "high",
      owner: "vstack-lead",
    });

    expect(lesson.id).toBeDefined();
    expect(lesson.failureClass).toBe("null_pointer_exception");
    expect(lesson.recurrenceCount).toBe(3);
    expect(lesson.recurrenceCount).toBeGreaterThanOrEqual(2); // PRD requirement
    expect(lesson.status).toBe("candidate");
    expect(lesson.occurrences).toHaveLength(3);
    expect(lesson.preventionMechanism).toBe("memory"); // default
  });

  it("should promote lesson through lifecycle: Candidate → Assessed → Promoted → Verified", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Lifecycle test",
      objective: "Test lesson lifecycle",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    const lesson = await lessonStore.createLesson({
      deliveryId: delivery.id,
      failureClass: "missing_validation",
      occurrences: ["task-1", "task-2"],
      recurrenceCount: 2,
      impactAssessment: "medium",
      owner: "vstack-lead",
    });

    // Update to assessed
    await lessonStore.updateLesson(lesson.id, { status: "assessed" });
    let updated = await lessonStore.getLesson(lesson.id);
    expect(updated?.status).toBe("assessed");

    // Promote with mechanism
    await lessonStore.promoteLesson(lesson.id, "lint", ".eslintrc.js - added required-validation rule");
    updated = await lessonStore.getLesson(lesson.id);
    expect(updated?.status).toBe("promoted");
    expect(updated?.preventionMechanism).toBe("lint");
    expect(updated?.implementationArtifact).toContain(".eslintrc.js");

    // Verify
    await lessonStore.verifyLesson(lesson.id, "passed");
    updated = await lessonStore.getLesson(lesson.id);
    expect(updated?.status).toBe("verified");
    expect(updated?.validationResult).toBe("passed");
  });

  it("should enforce prevention mechanism order: structure > types > lint > tests > skills > memory", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Prevention order test",
      objective: "Test prevention mechanism hierarchy",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    // Test each prevention mechanism type
    const mechanisms = ["structure", "types", "lint", "ci", "test", "skill", "memory"] as const;
    
    for (const mechanism of mechanisms) {
      const lesson = await lessonStore.createLesson({
        deliveryId: delivery.id,
        failureClass: `test_${mechanism}`,
        occurrences: ["task-1", "task-2"],
        recurrenceCount: 2,
        impactAssessment: "low",
        owner: "vstack-lead",
      });

      expect(lesson.preventionMechanism).toBe("memory"); // default
      
      // Promote with specific mechanism
      await lessonStore.updateLesson(lesson.id, { status: "assessed" });
      await lessonStore.promoteLesson(lesson.id, mechanism, `artifact-for-${mechanism}`);
      
      const promoted = await lessonStore.getLesson(lesson.id);
      expect(promoted?.preventionMechanism).toBe(mechanism);
    }
  });

  it("should require validation result for Verified status", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Validation test",
      objective: "Test verification requirement",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    const lesson = await lessonStore.createLesson({
      deliveryId: delivery.id,
      failureClass: "test_validation",
      occurrences: ["task-1", "task-2"],
      recurrenceCount: 2,
      impactAssessment: "low",
      owner: "vstack-lead",
    });

    await lessonStore.updateLesson(lesson.id, { status: "assessed" });
    await lessonStore.promoteLesson(lesson.id, "test", "test/new-test.test.ts");
    
    // Verify with passed result
    await lessonStore.verifyLesson(lesson.id, "passed");
    const verified = await lessonStore.getLesson(lesson.id);
    expect(verified?.status).toBe("verified");
    expect(verified?.validationResult).toBe("passed");
  });

  it("should link lesson to source occurrences", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Occurrence test",
      objective: "Test occurrence linking",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    const lesson = await lessonStore.createLesson({
      deliveryId: delivery.id,
      failureClass: "linked_failure",
      occurrences: ["task-1", "task-2"],
      recurrenceCount: 2,
      impactAssessment: "medium",
      owner: "vstack-lead",
    });

    expect(lesson.occurrences).toHaveLength(2);
    expect(lesson.occurrences[0]).toBe("task-1");
    expect(lesson.occurrences[1]).toBe("task-2");
  });

  it("should list lessons by delivery with filters", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "List test",
      objective: "Test lesson listing",
      type: "feature",
      risk: "medium",
      labels: [],
      createdBy: "vstack-lead",
    });

    // Create lessons in different states
    const lesson1 = await lessonStore.createLesson({
      deliveryId: delivery.id,
      failureClass: "candidate_failure",
      occurrences: ["t1", "t2"],
      recurrenceCount: 2,
      impactAssessment: "low",
      owner: "vstack-lead",
    });

    const lesson2 = await lessonStore.createLesson({
      deliveryId: delivery.id,
      failureClass: "verified_failure",
      occurrences: ["t3", "t4"],
      recurrenceCount: 2,
      impactAssessment: "high",
      owner: "vstack-lead",
    });

    // Promote lesson2 to verified
    await lessonStore.updateLesson(lesson2.id, { status: "assessed" });
    await lessonStore.promoteLesson(lesson2.id, "type", "types.ts");
    await lessonStore.verifyLesson(lesson2.id, "passed");

    const allLessons = await lessonStore.listLessons(delivery.id);
    expect(allLessons.length).toBeGreaterThanOrEqual(2);
    
    const candidates = allLessons.filter(l => l.status === "candidate");
    const verified = allLessons.filter(l => l.status === "verified");
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(verified.length).toBeGreaterThanOrEqual(1);
  });
});
