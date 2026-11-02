import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installAgents } from "../src/agents/agent-installer.js";

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function setup() {
  root = mkdtempSync(join(tmpdir(), "vstack-agents-"));
  const source = join(root, "source");
  const target = join(root, ".opencode", "agents");
  const statePath = join(root, ".vstack", "agents.json");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "vstack-lead.md"), "---\ndescription: lead\n---\n\n# Lead\n", "utf-8");
  return { source, target, statePath };
}

describe("agent installer", () => {
  it("installs agent files with a version marker", async () => {
    const { source, target, statePath } = setup();

    const result = await installAgents(source, target, statePath, "0.1.0");

    expect(result.installed).toEqual(["vstack-lead.md"]);
    const content = readFileSync(join(target, "vstack-lead.md"), "utf-8");
    expect(content).toContain("<!-- vstack-managed: 0.1.0 -->");
    expect(content).toContain("# Lead");
  });

  it("does not rewrite unchanged files", async () => {
    const { source, target, statePath } = setup();
    await installAgents(source, target, statePath, "0.1.0");

    const result = await installAgents(source, target, statePath, "0.1.0");

    expect(result.unchanged).toEqual(["vstack-lead.md"]);
    expect(result.installed).toEqual([]);
    expect(result.updated).toEqual([]);
  });

  it("preserves files the user customized", async () => {
    const { source, target, statePath } = setup();
    await installAgents(source, target, statePath, "0.1.0");
    const path = join(target, "vstack-lead.md");
    writeFileSync(path, readFileSync(path, "utf-8") + "\nuser note\n", "utf-8");

    const result = await installAgents(source, target, statePath, "0.2.0");

    expect(result.skipped).toEqual([{ file: "vstack-lead.md", reason: "user_customized" }]);
    expect(readFileSync(path, "utf-8")).toContain("user note");
    expect(readFileSync(path, "utf-8")).toContain("vstack-managed: 0.1.0");
  });

  it("updates an unmodified file on version change", async () => {
    const { source, target, statePath } = setup();
    await installAgents(source, target, statePath, "0.1.0");

    const result = await installAgents(source, target, statePath, "0.2.0");

    expect(result.updated).toEqual(["vstack-lead.md"]);
    expect(readFileSync(join(target, "vstack-lead.md"), "utf-8")).toContain("vstack-managed: 0.2.0");
  });
});
