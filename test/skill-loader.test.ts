import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillsFromDirectory } from "../src/skills/skill-loader.js";

let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function writeSkill(dir: string, id: string, body: string, description = "A skill") {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(
    join(dir, id, "SKILL.md"),
    `---\nname: ${id}\ndescription: "${description}"\n---\n\n${body}\n`,
    "utf-8"
  );
}

describe("skill loader", () => {
  it("loads nested skills with frontmatter metadata", async () => {
    root = mkdtempSync(join(tmpdir(), "vstack-skills-"));
    const roles = join(root, "roles");
    writeSkill(join(root), "vstack-testing", "# Testing\n\nWrite tests.");
    writeSkill(roles, "vstack-role-developer", "# Developer\n\nBuild things.", "Developer role");

    const skills = await loadSkillsFromDirectory(root);

    expect(skills).toHaveLength(2);
    const testing = skills.find((s) => s.id === "vstack-testing");
    expect(testing?.name).toBe("vstack-testing");
    expect(testing?.description).toBe("A skill");
    expect(testing?.content).toContain("# Testing");
    expect(skills.find((s) => s.id === "vstack-role-developer")?.description).toBe("Developer role");
  });

  it("ignores directories without a SKILL.md", async () => {
    root = mkdtempSync(join(tmpdir(), "vstack-skills-"));
    mkdirSync(join(root, "empty"), { recursive: true });

    const skills = await loadSkillsFromDirectory(root);

    expect(skills).toEqual([]);
  });
});
