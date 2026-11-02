/**
 * Agent definition installer.
 *
 * OpenCode loads agents from `.opencode/agents/*.md`. The plugin copies the
 * portable vstack agent wrappers into that directory, marks managed files,
 * and refuses to overwrite files the user has edited.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const MARKER_PREFIX = "<!-- vstack-managed:";

interface ManagedFileRecord {
  sourceHash: string;
  installedHash: string;
  version: string;
}

interface InstallerState {
  schemaVersion: 1;
  version: string;
  files: Record<string, ManagedFileRecord>;
}

export interface AgentInstallResult {
  version: string;
  installed: string[];
  updated: string[];
  unchanged: string[];
  skipped: Array<{ file: string; reason: "user_customized" | "unmanaged_file" }>;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readState(statePath: string): InstallerState {
  if (!existsSync(statePath)) {
    return { schemaVersion: 1, version: "", files: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as InstallerState;
    if (parsed.schemaVersion === 1 && parsed.files) return parsed;
  } catch {
    // Rewrite a corrupt state file below.
  }
  return { schemaVersion: 1, version: "", files: {} };
}

function marker(version: string): string {
  return `${MARKER_PREFIX} ${version} -->`;
}

/**
 * Insert the managed marker after YAML frontmatter so OpenCode still parses
 * the agent definition correctly.
 */
export function markAgentContent(content: string, version: string): string {
  const line = marker(version);
  if (content.includes(MARKER_PREFIX)) {
    return content.replace(/<!-- vstack-managed:[^>]*-->/, line);
  }
  const frontmatter = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (frontmatter) {
    return `${frontmatter[0]}${line}\n${content.slice(frontmatter[0].length)}`;
  }
  return `${line}\n${content}`;
}

export async function installAgents(
  sourceDir: string,
  targetDir: string,
  statePath: string,
  version: string
): Promise<AgentInstallResult> {
  const source = resolve(sourceDir);
  const result: AgentInstallResult = {
    version,
    installed: [],
    updated: [],
    unchanged: [],
    skipped: [],
  };

  if (!existsSync(source)) return result;

  mkdirSync(targetDir, { recursive: true });
  const state = readState(statePath);
  const nextState: InstallerState = { schemaVersion: 1, version, files: {} };

  const files = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    const sourceContent = readFileSync(join(source, file), "utf-8");
    const sourceHash = hash(sourceContent);
    const targetPath = join(targetDir, file);
    const installedContent = markAgentContent(sourceContent, version);
    const installedHash = hash(installedContent);
    const previous = state.files[file];

    if (!existsSync(targetPath)) {
      writeFileSync(targetPath, installedContent, "utf-8");
      result.installed.push(file);
      nextState.files[file] = { sourceHash, installedHash, version };
      continue;
    }

    const currentContent = readFileSync(targetPath, "utf-8");
    const currentHash = hash(currentContent);

    if (!previous) {
      // A file exists that vstack has no record of creating.
      if (currentContent.includes(MARKER_PREFIX)) {
        // Managed by an older install whose state file was lost: adopt it.
        writeFileSync(targetPath, installedContent, "utf-8");
        result.updated.push(file);
        nextState.files[file] = { sourceHash, installedHash, version };
      } else {
        result.skipped.push({ file, reason: "unmanaged_file" });
      }
      continue;
    }

    if (currentHash !== previous.installedHash) {
      result.skipped.push({ file, reason: "user_customized" });
      nextState.files[file] = previous;
      continue;
    }

    if (previous.sourceHash === sourceHash && previous.version === version) {
      result.unchanged.push(file);
      nextState.files[file] = previous;
      continue;
    }

    writeFileSync(targetPath, installedContent, "utf-8");
    result.updated.push(file);
    nextState.files[file] = { sourceHash, installedHash, version };
  }

  // Keep records for skipped files so a later upgrade can still compare them.
  for (const [file, record] of Object.entries(state.files)) {
    if (!nextState.files[file]) nextState.files[file] = record;
  }

  mkdirSync(resolve(statePath, ".."), { recursive: true });
  writeFileSync(statePath, JSON.stringify(nextState, null, 2), "utf-8");

  return result;
}
