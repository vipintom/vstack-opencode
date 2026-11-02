/**
 * Check discovery.
 *
 * Reads project manifests and task files to infer runnable checks. No
 * hard-coded commands: every check comes from the project's own config.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EvidenceType } from "../schemas/types.js";

export type CheckSource = "package.json" | "turbo.json" | "makefile" | "justfile" | "ci";

export interface DiscoveredCheck {
  id: string;
  type: EvidenceType;
  command: string[];
  workingDirectory: string;
  source: CheckSource;
  description?: string;
}

const SCRIPT_TO_CHECK: Record<string, { id: string; type: EvidenceType }> = {
  build: { id: "build", type: "build" },
  compile: { id: "build", type: "build" },
  lint: { id: "lint", type: "lint" },
  "lint:fix": { id: "lint", type: "lint" },
  typecheck: { id: "typecheck", type: "typecheck" },
  "type-check": { id: "typecheck", type: "typecheck" },
  "types:check": { id: "typecheck", type: "typecheck" },
  test: { id: "test:unit", type: "test:unit" },
  "test:unit": { id: "test:unit", type: "test:unit" },
  "test:integration": { id: "test:integration", type: "test:integration" },
  "test:e2e": { id: "test:e2e", type: "test:e2e" },
  "test:coverage": { id: "coverage", type: "coverage" },
  coverage: { id: "coverage", type: "coverage" },
  "security:deps": { id: "security:deps", type: "security:deps" },
  "security:audit": { id: "security:deps", type: "security:deps" },
  audit: { id: "security:deps", type: "security:deps" },
  "security:secrets": { id: "security:secrets", type: "security:secrets" },
};

function detectPackageManager(root: string): string {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) return "bun";
  return "npm";
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function discoverFromPackageJson(root: string, packageManager: string): DiscoveredCheck[] {
  const manifest = readJson(join(root, "package.json"));
  if (!manifest) return [];

  const scripts = manifest.scripts;
  if (!scripts || typeof scripts !== "object") return [];

  const checks: DiscoveredCheck[] = [];
  for (const [scriptName, mapping] of Object.entries(SCRIPT_TO_CHECK)) {
    if (!(scriptName in (scripts as Record<string, unknown>))) continue;
    checks.push({
      id: mapping.id,
      type: mapping.type,
      command: [packageManager, "run", scriptName],
      workingDirectory: root,
      source: "package.json",
      description: String((scripts as Record<string, unknown>)[scriptName]),
    });
  }
  return checks;
}

function discoverFromTurbo(root: string, packageManager: string): DiscoveredCheck[] {
  const turbo = readJson(join(root, "turbo.json"));
  if (!turbo) return [];

  const pipeline = (turbo.pipeline ?? turbo.tasks) as Record<string, unknown> | undefined;
  if (!pipeline) return [];

  const checks: DiscoveredCheck[] = [];
  for (const [taskName, mapping] of Object.entries(SCRIPT_TO_CHECK)) {
    if (!(taskName in pipeline)) continue;
    checks.push({
      id: mapping.id,
      type: mapping.type,
      command: [packageManager, "run", taskName],
      workingDirectory: root,
      source: "turbo.json",
      description: `turbo task ${taskName}`,
    });
  }
  return checks;
}

function discoverFromMakefile(root: string): DiscoveredCheck[] {
  const makefilePath = join(root, "Makefile");
  if (!existsSync(makefilePath)) return [];

  const content = readFileSync(makefilePath, "utf-8");
  const targets = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+):(?!=)/);
    if (match?.[1]) targets.add(match[1]);
  }

  const checks: DiscoveredCheck[] = [];
  for (const [targetName, mapping] of Object.entries(SCRIPT_TO_CHECK)) {
    if (!targets.has(targetName)) continue;
    checks.push({
      id: mapping.id,
      type: mapping.type,
      command: ["make", targetName],
      workingDirectory: root,
      source: "makefile",
      description: `make ${targetName}`,
    });
  }
  return checks;
}

function discoverFromJustfile(root: string): DiscoveredCheck[] {
  const justfilePath = join(root, "justfile");
  if (!existsSync(justfilePath)) return [];

  const content = readFileSync(justfilePath, "utf-8");
  const recipes = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+)(?:\s+[^:]*)?:/);
    if (match?.[1]) recipes.add(match[1]);
  }

  const checks: DiscoveredCheck[] = [];
  for (const [recipeName, mapping] of Object.entries(SCRIPT_TO_CHECK)) {
    if (!recipes.has(recipeName)) continue;
    checks.push({
      id: mapping.id,
      type: mapping.type,
      command: ["just", recipeName],
      workingDirectory: root,
      source: "justfile",
      description: `just ${recipeName}`,
    });
  }
  return checks;
}

function discoverFromCi(root: string, packageManager: string): DiscoveredCheck[] {
  const workflowsDir = join(root, ".github", "workflows");
  if (!existsSync(workflowsDir)) return [];

  const runPattern = new RegExp(
    `(?:${packageManager}|npm|yarn)\\s+(?:run\\s+)?([A-Za-z0-9:_-]+)`,
    "g"
  );

  const checks: DiscoveredCheck[] = [];
  let workflowFiles: string[];
  try {
    workflowFiles = readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name));
  } catch {
    return [];
  }

  for (const fileName of workflowFiles) {
    const content = readFileSync(join(workflowsDir, fileName), "utf-8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("run:")) continue;
      const commandText = trimmed.slice(4).trim();
      for (const match of commandText.matchAll(runPattern)) {
        const scriptName = match[1];
        if (!scriptName) continue;
        const mapping = SCRIPT_TO_CHECK[scriptName];
        if (!mapping) continue;
        checks.push({
          id: mapping.id,
          type: mapping.type,
          command: [packageManager, "run", scriptName],
          workingDirectory: root,
          source: "ci",
          description: `${fileName}: ${commandText}`,
        });
      }
    }
  }
  return checks;
}

export async function discoverChecks(projectRoot: string): Promise<DiscoveredCheck[]> {
  const root = resolve(projectRoot);
  if (!existsSync(root)) return [];

  const packageManager = detectPackageManager(root);

  const checks = [
    ...discoverFromPackageJson(root, packageManager),
    ...discoverFromTurbo(root, packageManager),
    ...discoverFromMakefile(root),
    ...discoverFromJustfile(root),
    ...discoverFromCi(root, packageManager),
  ];

  const seen = new Set<string>();
  const unique: DiscoveredCheck[] = [];
  for (const check of checks) {
    if (seen.has(check.id)) continue;
    seen.add(check.id);
    unique.push(check);
  }
  return unique;
}
