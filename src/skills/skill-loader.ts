/**
 * Load vstack skills from the @vstack/agents-skills content package.
 *
 * Skills are plain directories containing a SKILL.md with YAML frontmatter.
 * The loader walks nested role and workflow skill directories and returns
 * the values required by OpenCode's Skill.Info.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface LoadedSkill {
  id: string;
  name: string;
  description?: string;
  autoinvoke?: boolean;
  path: string;
  content: string;
}

interface Frontmatter {
  [key: string]: string;
}

function parseFrontmatter(content: string): { data: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match || !match[1]) return { data: {}, body: content };

  const data: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) data[key] = value;
  }

  return { data, body: content.slice(match[0].length) };
}

function walkSkillFiles(root: string): string[] {
  const results: string[] = [];

  function walk(directory: string): void {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    }
  }

  walk(root);
  return results.sort();
}

export async function loadSkillsFromDirectory(skillsRoot: string): Promise<LoadedSkill[]> {
  const root = resolve(skillsRoot);
  if (!existsSync(root)) return [];

  const skills: LoadedSkill[] = [];
  for (const filePath of walkSkillFiles(root)) {
    const content = readFileSync(filePath, "utf-8");
    const { data } = parseFrontmatter(content);
    const directoryName = filePath.split(/[\\/]/).at(-2) ?? "";
    const id = data.name || directoryName;
    if (!id) continue;

    skills.push({
      id,
      name: id,
      description: data.description || undefined,
      autoinvoke: data.autoinvoke === "true" ? true : undefined,
      path: filePath,
      content,
    });
  }

  return skills;
}

/**
 * Locate the agents-skills package or playbook. Checks an explicit override, the
 * project's node_modules, then the monorepo sibling layout used in development.
 */
export function findAgentsSkillsRoot(projectRoot: string, pluginRoot?: string): string | null {
  const candidates = [
    process.env.VSTACK_AGENTS_SKILLS,
    process.env.VSTACK_PLAYBOOK,
    join(projectRoot, "node_modules", "@vstack", "agents-skills"),
    join(projectRoot, "node_modules", "@vstack", "playbook"),
    pluginRoot ? join(pluginRoot, "..", "..", "agents-skills") : undefined,
    pluginRoot ? join(pluginRoot, "..", "..", "playbook") : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "skills"))) return resolve(candidate);
  }
  return null;
}
