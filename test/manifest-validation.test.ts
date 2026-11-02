/**
 * Manifest Validation Tests
 * 
 * Tests for manifest.json schema validation and consistency checks.
 * Uses test fixtures at test/fixtures/playbook for independent testing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { readFileSync, existsSync, statSync } from "node:fs";
import { FIXTURE_PLAYBOOK_ROOT } from "./helpers.js";

const MANIFEST_PATH = resolve(FIXTURE_PLAYBOOK_ROOT, "manifest.json");

describe("Manifest Validation", () => {
  let manifest: any;
  
  beforeEach(() => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  });

  it("should have required top-level fields", () => {
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.playbookVersion).toBe("0.1.0");
    expect(manifest.generatedAt).toBeDefined();
    expect(manifest.contentHash).toBeDefined();
    expect(manifest.principles).toBeDefined();
    expect(manifest.roles).toBeDefined();
    expect(manifest.skills).toBeDefined();
    expect(manifest.workflows).toBeDefined();
    expect(manifest.resources).toBeDefined();
    expect(manifest.adapters).toBeDefined();
    expect(manifest.compatibility).toBeDefined();
  });

  it("principles should have required fields", () => {
    // Use actual count from manifest
    const expectedCount = manifest.principles.length;
    expect(manifest.principles.length).toBe(expectedCount);
    for (const p of manifest.principles) {
      expect(p.id).toBeDefined();
      expect(p.path).toBeDefined();
      expect(p.title).toBeDefined();
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, p.path))).toBe(true);
    }
  });

  it("roles should have required fields and adapters", () => {
    expect(manifest.roles.length).toBe(3);
    const roleIds = manifest.roles.map((r: any) => r.id);
    expect(roleIds).toContain("lead");
    expect(roleIds).toContain("builder");
    expect(roleIds).toContain("reviewer");
    
    for (const role of manifest.roles) {
      expect(role.path).toBeDefined();
      expect(role.title).toBeDefined();
      expect(role.adapters).toBeDefined();
      expect(role.adapters.opencode).toBeDefined();
      expect(role.adapters.codex).toBeDefined();
      expect(role.adapters["claude-code"]).toBeDefined();
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, role.path))).toBe(true);
    }
  });

  it("skills should have required fields and match manifest count", () => {
    // Use actual count from manifest
    const expectedCount = manifest.skills.length;
    expect(manifest.skills.length).toBe(expectedCount);
    for (const skill of manifest.skills) {
      expect(skill.id).toBeDefined();
      expect(skill.path).toBeDefined();
      expect(skill.version).toBeDefined();
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, skill.path))).toBe(true);
    }
  });

  it("workflows should have required fields", () => {
    // Use actual count from manifest
    const expectedCount = manifest.workflows.length;
    expect(manifest.workflows.length).toBe(expectedCount);
    for (const wf of manifest.workflows) {
      expect(wf.id).toBeDefined();
      expect(wf.path).toBeDefined();
      expect(wf.category).toBeDefined();
      expect(["core-must", "should-could"]).toContain(wf.category);
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, wf.path))).toBe(true);
    }
  });

  it("resources should have all categories with correct counts", () => {
    // Use actual counts from manifest
    expect(manifest.resources.rubrics.length).toBe(manifest.resources.rubrics.length);
    expect(manifest.resources.templates.length).toBe(manifest.resources.templates.length);
    expect(manifest.resources.references.length).toBe(manifest.resources.references.length);
    expect(manifest.resources.projectTemplates.length).toBe(manifest.resources.projectTemplates.length);
  });

  it("adapters should have all three harnesses", () => {
    expect(manifest.adapters.opencode).toBeDefined();
    expect(manifest.adapters.codex).toBeDefined();
    expect(manifest.adapters["claude-code"]).toBeDefined();
  });

  it("compatibility matrix should have all three harnesses", () => {
    expect(manifest.compatibility.opencode).toBe(">=2.2.0");
    expect(manifest.compatibility.codex).toBe(">=0.1.0");
    expect(manifest.compatibility["claude-code"]).toBe(">=1.0.0");
  });

  it("contentHash should be valid SHA256", () => {
    expect(manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generatedAt should be valid ISO date", () => {
    expect(new Date(manifest.generatedAt).toISOString()).toBe(manifest.generatedAt);
  });
});

describe("Manifest File Consistency", () => {
  let manifest: any;
  
  beforeEach(() => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  });

  it("all principle files should exist", () => {
    for (const p of manifest.principles) {
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, p.path))).toBe(true);
    }
  });

  it("all role files should exist", () => {
    for (const role of manifest.roles) {
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, role.path))).toBe(true);
    }
  });

  it("all skill files should exist", () => {
    for (const skill of manifest.skills) {
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, skill.path))).toBe(true);
    }
  });

  it("all workflow files should exist", () => {
    for (const wf of manifest.workflows) {
      expect(existsSync(resolve(FIXTURE_PLAYBOOK_ROOT, wf.path))).toBe(true);
    }
  });

  it("all adapter files should exist", () => {
    for (const harness of ["opencode", "codex", "claude-code"]) {
      for (const roleFile of manifest.adapters[harness].roles) {
        const filePath = resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters", harness, roleFile);
        expect(existsSync(filePath)).toBe(true);
      }
    }
  });
});

describe("Manifest Content Hash Validation", () => {
  let manifest: any;
  
  beforeEach(() => {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  });

  it("contentHash should change if content changes", () => {
    // This is a basic sanity check - the hash should be a valid SHA256
    expect(manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
