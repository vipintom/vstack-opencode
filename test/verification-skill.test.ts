/**
 * Project Verification Skill Tests
 * 
 * Tests for project verification skill creation and maintenance.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { FIXTURE_PLAYBOOK_ROOT } from "./helpers.js";
import { VstackPaths, ensureVstackDirs } from "../src/persistence/repository-root.js";
import { initializeEventLog } from "../src/persistence/event-log.js";
import { createDeliveryStore } from "../src/deliveries/delivery-store.js";
import { createTaskStore } from "../src/tasks/task-store.js";
import { createProjectVerificationStore } from "../src/tasks/verification-index-store.js";

const TEST_VSTACK_ROOT = resolve("/tmp", "vstack-verification-test");

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

describe("Project Verification Skill", () => {
  let paths: VstackPaths;
  let deliveryStore: ReturnType<typeof createDeliveryStore>;
  let taskStore: ReturnType<typeof createTaskStore>;
  let verificationIndexStore: ReturnType<typeof createProjectVerificationStore>;

  beforeEach(async () => {
    await cleanupTestRoot();
    paths = createTestVstackPaths();
    await ensureVstackDirs(paths);
    await initializeEventLog(paths);

    deliveryStore = await createDeliveryStore(paths);
    taskStore = await createTaskStore(paths);
    verificationIndexStore = await createProjectVerificationStore(paths);
  });

  it("should create verification skill index with all required fields", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Verification test",
      objective: "Test verification skill",
      type: "skill-maintenance",
      risk: "low",
      labels: [],
      createdBy: "vstack-lead",
    });

    const index = await verificationIndexStore.createIndex({
      deliveryId: delivery.id,
      projectPath: process.cwd(),
      harness: "opencode",
      skillPath: ".vstack/skills/project-verification.md",
      version: "1.0.0",
      surfaceCoverage: ["api", "cli"],
      gaps: [],
    });

    expect(index.id).toBeDefined();
    expect(index.skillPath).toBe(".vstack/skills/project-verification.md");
    expect(index.harness).toBe("opencode");
    expect(index.version).toBe("1.0.0");
    expect(index.surfaceCoverage).toContain("api");
    expect(index.surfaceCoverage).toContain("cli");
    expect(index.status).toBe("current");
    expect(index.contentHash).toBeDefined();
  });

  it("should update index when skill changes", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Update test",
      objective: "Test update",
      type: "skill-maintenance",
      risk: "low",
      labels: [],
      createdBy: "vstack-lead",
    });

    const index = await verificationIndexStore.createIndex({
      deliveryId: delivery.id,
      projectPath: process.cwd(),
      harness: "opencode",
      skillPath: ".vstack/skills/project-verification.md",
      version: "1.0.0",
      surfaceCoverage: ["api"],
      gaps: [],
    });

    // Update with new version
    const updated = await verificationIndexStore.updateIndex(index.id, {
      version: "1.1.0",
      surfaceCoverage: ["api", "cli"],
      lastValidated: new Date().toISOString(),
      validationEvidence: ["Updated validation"],
      status: "current",
    });

    expect(updated.version).toBe("1.1.0");
    expect(updated.surfaceCoverage).toContain("cli");
    expect(updated.revision).toBe(2);
  });

  it("should validate freshness and mark stale", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Freshness test",
      objective: "Test freshness",
      type: "skill-maintenance",
      risk: "low",
      labels: [],
      createdBy: "vstack-lead",
    });

    const index = await verificationIndexStore.createIndex({
      deliveryId: delivery.id,
      projectPath: process.cwd(),
      harness: "opencode",
      skillPath: ".vstack/skills/non-existent.md",
      version: "1.0.0",
      surfaceCoverage: ["api"],
      gaps: [],
    });

    // Validate freshness - should mark as missing
    const validated = await verificationIndexStore.validateFreshness(index.id);
    expect(validated.status).toBe("missing");
    expect(validated.gaps).toContain("Skill file missing");
  });

  it("should support multiple harnesses", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "Multi-harness test",
      objective: "Test multiple harnesses",
      type: "skill-maintenance",
      risk: "low",
      labels: [],
      createdBy: "vstack-lead",
    });

    const opencodeIndex = await verificationIndexStore.createIndex({
      deliveryId: delivery.id,
      projectPath: process.cwd(),
      harness: "opencode",
      skillPath: ".vstack/skills/project-verification.md",
      version: "1.0.0",
      surfaceCoverage: ["api"],
      gaps: [],
    });

    const codexIndex = await verificationIndexStore.createIndex({
      deliveryId: delivery.id,
      projectPath: process.cwd(),
      harness: "codex",
      skillPath: ".codex/skills/project-verification.md",
      version: "1.0.0",
      surfaceCoverage: ["api"],
      gaps: [],
    });

    expect(opencodeIndex.harness).toBe("opencode");
    expect(codexIndex.harness).toBe("codex");
  });

  it("should list indices by delivery", async () => {
    const delivery = await deliveryStore.createDelivery({
      title: "List test",
      objective: "Test listing",
      type: "skill-maintenance",
      risk: "low",
      labels: [],
      createdBy: "vstack-lead",
    });

    await verificationIndexStore.createIndex({
      deliveryId: delivery.id,
      projectPath: process.cwd(),
      harness: "opencode",
      skillPath: ".vstack/skills/project-verification.md",
      version: "1.0.0",
      surfaceCoverage: ["api"],
      gaps: [],
    });

    await verificationIndexStore.createIndex({
      deliveryId: delivery.id,
      projectPath: process.cwd(),
      harness: "codex",
      skillPath: ".codex/skills/project-verification.md",
      version: "1.0.0",
      surfaceCoverage: ["api"],
      gaps: [],
    });

    const indices = await verificationIndexStore.listIndexes(delivery.id);
    expect(indices.length).toBeGreaterThanOrEqual(2);
  });

  it("verification skill template should have all required sections", () => {
    const templatePath = resolve(FIXTURE_PLAYBOOK_ROOT, "project-templates/verification-skill/SKILL.md.hbs");
    const template = readFileSync(templatePath, "utf-8");

    // Check for required sections per PRD 9.8.2 - match actual template
    const requiredSections = [
      "Project Overview",
      "Prerequisites",
      "Commands",
      "Install",
      "Build",
      "Start Development",
      "Run Tests",
      "Application Surfaces",
      "Verification Sections",
      "Setup",
      "Run",
      "Health",
      "Drive",
      "Observe",
      "Cleanup",
      "Gaps & Limitations",
      "Validation",
    ];

    for (const section of requiredSections) {
      expect(template).toContain(section);
    }
  });
});
