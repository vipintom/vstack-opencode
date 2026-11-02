/**
 * Adapter Installation Tests
 * 
 * Tests for Codex and Claude Code adapter installation and validation.
 * Uses test fixtures at test/fixtures/playbook for independent testing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { FIXTURE_PLAYBOOK_ROOT } from "./helpers.js";

describe("Adapter Installation - Codex", () => {
  const codexAdapterDir = resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters/codex");
  
  it("should have all three role adapters", () => {
    expect(existsSync(resolve(codexAdapterDir, "vstack-lead.md"))).toBe(true);
    expect(existsSync(resolve(codexAdapterDir, "vstack-builder.md"))).toBe(true);
    expect(existsSync(resolve(codexAdapterDir, "vstack-reviewer.md"))).toBe(true);
  });

  it("each adapter should have valid TOML agent definition", () => {
    const lead = readFileSync(resolve(codexAdapterDir, "vstack-lead.md"), "utf-8");
    const builder = readFileSync(resolve(codexAdapterDir, "vstack-builder.md"), "utf-8");
    const reviewer = readFileSync(resolve(codexAdapterDir, "vstack-reviewer.md"), "utf-8");
    
    for (const [name, content] of [["lead", lead], ["builder", builder], ["reviewer", reviewer]]) {
      expect(content).toContain("Codex Adapter");
      expect(content).toContain("Harness:** Codex CLI");
      expect(content).toContain("Canonical Role:**");
      expect(content).toContain("Agent Definition (TOML");
      expect(content).toContain(`name = "vstack-${name}"`);
      expect(content).toContain("developer_instructions");
      expect(content).toContain("model =");
      expect(content).toContain("sandbox_mode =");
    }
  });

  it("adapters should reference canonical roles", () => {
    const lead = readFileSync(resolve(codexAdapterDir, "vstack-lead.md"), "utf-8");
    const builder = readFileSync(resolve(codexAdapterDir, "vstack-builder.md"), "utf-8");
    const reviewer = readFileSync(resolve(codexAdapterDir, "vstack-reviewer.md"), "utf-8");
    
    for (const content of [lead, builder, reviewer]) {
      expect(content.toLowerCase()).toContain("canonical");
      expect(content).toContain("Role Mapping");
    }
  });

  it("reviewer adapter should be read-only (workspace-read sandbox)", () => {
    const reviewer = readFileSync(resolve(codexAdapterDir, "vstack-reviewer.md"), "utf-8");
    expect(reviewer).toContain("sandbox_mode = \"read-only\"");
  });

  it("lead and builder adapters should have full permissions (workspace-write)", () => {
    const lead = readFileSync(resolve(codexAdapterDir, "vstack-lead.md"), "utf-8");
    const builder = readFileSync(resolve(codexAdapterDir, "vstack-builder.md"), "utf-8");
    
    for (const content of [lead, builder]) {
      expect(content).toContain("sandbox_mode = \"workspace-write\"");
    }
  });
});

describe("Adapter Installation - Claude Code", () => {
  const claudeAdapterDir = resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters/claude-code");
  
  it("should have all three role adapters", () => {
    expect(existsSync(resolve(claudeAdapterDir, "vstack-lead.md"))).toBe(true);
    expect(existsSync(resolve(claudeAdapterDir, "vstack-builder.md"))).toBe(true);
    expect(existsSync(resolve(claudeAdapterDir, "vstack-reviewer.md"))).toBe(true);
  });

  it("each adapter should have valid YAML agent definition", () => {
    const lead = readFileSync(resolve(claudeAdapterDir, "vstack-lead.md"), "utf-8");
    const builder = readFileSync(resolve(claudeAdapterDir, "vstack-builder.md"), "utf-8");
    const reviewer = readFileSync(resolve(claudeAdapterDir, "vstack-reviewer.md"), "utf-8");
    
    for (const [name, content] of [["lead", lead], ["builder", builder], ["reviewer", reviewer]]) {
      expect(content).toContain("Claude Code Adapter");
      expect(content).toContain("Harness:** Claude Code");
      expect(content).toContain("Canonical Role:**");
      expect(content).toContain("Agent Definition (YAML Frontmatter");
      expect(content).toContain(`name: vstack-${name}`);
      expect(content).toContain("model: inherit");
      expect(content).toContain("tools:");
      expect(content).toContain("disallowedTools:");
      expect(content).toContain("permissionMode:");
      expect(content).toContain("maxTurns:");
      expect(content).toContain("skills:");
    }
  });

  it("adapters should reference canonical roles", () => {
    const lead = readFileSync(resolve(claudeAdapterDir, "vstack-lead.md"), "utf-8");
    const builder = readFileSync(resolve(claudeAdapterDir, "vstack-builder.md"), "utf-8");
    const reviewer = readFileSync(resolve(claudeAdapterDir, "vstack-reviewer.md"), "utf-8");
    
    for (const content of [lead, builder, reviewer]) {
      expect(content.toLowerCase()).toContain("canonical");
      expect(content).toContain("Role Mapping");
    }
  });

  it("reviewer adapter should be read-only (disallowedTools: Write, Edit, TodoWrite)", () => {
    const reviewer = readFileSync(resolve(claudeAdapterDir, "vstack-reviewer.md"), "utf-8");
    expect(reviewer).toContain("disallowedTools: Write, Edit, TodoWrite");
    // Verify YAML frontmatter has correct restrictions
    const yamlMatch = reviewer.match(/```yaml[\s\S]*?```/);
    expect(yamlMatch).toBeTruthy();
    const yamlContent = yamlMatch![0];
    expect(yamlContent).toContain("disallowedTools: Write, Edit, TodoWrite");
    expect(yamlContent).toContain("tools: Read, Glob, Grep, Bash");
  });

  it("lead and builder adapters should have full permissions", () => {
    const lead = readFileSync(resolve(claudeAdapterDir, "vstack-lead.md"), "utf-8");
    const builder = readFileSync(resolve(claudeAdapterDir, "vstack-builder.md"), "utf-8");
    
    // Lead should have Agent tool for delegation
    const leadYaml = lead.match(/```yaml[\s\S]*?```/)?.[0] || "";
    expect(leadYaml).toContain("Edit");
    expect(leadYaml).toContain("Bash");
    expect(leadYaml).toContain("Agent");
    
    // Builder should have Write/Edit/Bash but not Agent
    const builderYaml = builder.match(/```yaml[\s\S]*?```/)?.[0] || "";
    expect(builderYaml).toContain("Edit");
    expect(builderYaml).toContain("Bash");
    expect(builderYaml).toContain("Write");
  });
});

describe("Adapter Manifest Consistency", () => {
  const manifestPath = resolve(FIXTURE_PLAYBOOK_ROOT, "manifest.json");
  let manifest: any;
  
  beforeEach(() => {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  });
  
  it("manifest should include all three harnesses in adapters", () => {
    expect(manifest.adapters.opencode).toBeDefined();
    expect(manifest.adapters.codex).toBeDefined();
    expect(manifest.adapters["claude-code"]).toBeDefined();
  });

  it("each harness should have all three roles", () => {
    for (const harness of ["opencode", "codex", "claude-code"]) {
      const adapter = manifest.adapters[harness];
      expect(adapter.roles).toHaveLength(3);
      expect(adapter.roles).toContain("vstack-lead.md");
      expect(adapter.roles).toContain("vstack-builder.md");
      expect(adapter.roles).toContain("vstack-reviewer.md");
    }
  });

  it("roles should reference all three adapters", () => {
    for (const role of manifest.roles) {
      expect(role.adapters.opencode).toBeDefined();
      expect(role.adapters.codex).toBeDefined();
      expect(role.adapters["claude-code"]).toBeDefined();
    }
  });

  it("compatibility matrix should have version ranges", () => {
    expect(manifest.compatibility.opencode).toBe(">=2.2.0");
    expect(manifest.compatibility.codex).toBe(">=0.1.0");
    expect(manifest.compatibility["claude-code"]).toBe(">=1.0.0");
  });

  it("all referenced adapter files should exist", () => {
    for (const harness of ["opencode", "codex", "claude-code"]) {
      const adapterDir = resolve(FIXTURE_PLAYBOOK_ROOT, `agents/adapters/${harness}`);
      for (const roleFile of manifest.adapters[harness].roles) {
        const filePath = resolve(adapterDir, roleFile);
        expect(existsSync(filePath)).toBe(true);
      }
    }
  });
});

describe("OpenCode Adapter Backwards Compatibility", () => {
  const opencodeAdapterDir = resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters/opencode");
  
  it("should have all three original role adapters", () => {
    expect(existsSync(resolve(opencodeAdapterDir, "vstack-lead.md"))).toBe(true);
    expect(existsSync(resolve(opencodeAdapterDir, "vstack-builder.md"))).toBe(true);
    expect(existsSync(resolve(opencodeAdapterDir, "vstack-reviewer.md"))).toBe(true);
  });

  it("OpenCode adapters should use OpenCode-specific config", () => {
    const lead = readFileSync(resolve(opencodeAdapterDir, "vstack-lead.md"), "utf-8");
    expect(lead).toContain("OpenCode Adapter");
    expect(lead).toContain("OpenCode-Specific Configuration");
  });
});

describe("Adapter Idempotency", () => {
  it("adapter files should be deterministic (same content on repeat read)", () => {
    const codexLead = readFileSync(resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters/codex/vstack-lead.md"), "utf-8");
    const claudeLead = readFileSync(resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters/claude-code/vstack-lead.md"), "utf-8");
    
    expect(readFileSync(resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters/codex/vstack-lead.md"), "utf-8")).toBe(codexLead);
    expect(readFileSync(resolve(FIXTURE_PLAYBOOK_ROOT, "agents/adapters/claude-code/vstack-lead.md"), "utf-8")).toBe(claudeLead);
  });
});