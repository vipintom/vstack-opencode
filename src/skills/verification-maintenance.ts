/**
 * Verification Skill Maintenance and Freshness
 * 
 * Tracks verification skill freshness via content hash comparison,
 * maintenance triggers, and validation procedures.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { ProjectVerificationIndex } from "../schemas/types.js";

export interface MaintenanceTrigger {
  type: "command_change" | "config_change" | "test_change" | "entry_point_change" | "dependency_change" | "time_based" | "manual";
  description: string;
  affectedFiles: string[];
  severity: "low" | "medium" | "high" | "critical";
  detectedAt: string;
}

export interface FreshnessCheckResult {
  skillPath: string;
  index: ProjectVerificationIndex | null;
  isFresh: boolean;
  triggers: MaintenanceTrigger[];
  lastValidated: string;
  daysSinceValidation: number;
  contentHash: string;
  currentHash: string;
  hashChanged: boolean;
  validationRequired: boolean;
  recommendedActions: string[];
}

export interface ValidationProcedure {
  name: string;
  description: string;
  command: string[];
  expectedOutput: string;
  timeoutMs: number;
}

export interface SmokeTestResult {
  passed: boolean;
  output: string;
  durationMs: number;
  errors: string[];
}

export async function checkVerificationSkillFreshness(
  paths: VstackPaths,
  skillPath: string,
  verificationIndexStore: any
): Promise<FreshnessCheckResult> {
  const now = new Date().toISOString();
  
  // Get the verification index for this skill
  const index = await verificationIndexStore.getIndexByPath(skillPath);
  
  if (!index) {
    return {
      skillPath,
      index: null,
      isFresh: false,
      triggers: [{
        type: "manual",
        description: "No verification index found for this skill",
        affectedFiles: [skillPath],
        severity: "high",
        detectedAt: now,
      }],
      lastValidated: "never",
      daysSinceValidation: Infinity,
      contentHash: "",
      currentHash: computeFileHash(skillPath),
      hashChanged: true,
      validationRequired: true,
      recommendedActions: ["Create verification index for this skill", "Run initial validation"],
    };
  }
  
  // Compute current content hash
  const currentHash = computeFileHash(skillPath);
  const hashChanged = index.contentHash !== currentHash && index.contentHash !== "uncomputed" && index.contentHash !== "unreadable";
  
  // Check days since validation
  const lastValidated = new Date(index.lastValidated);
  const daysSinceValidation = (Date.now() - lastValidated.getTime()) / (1000 * 60 * 60 * 24);
  
  // Determine triggers
  const triggers: MaintenanceTrigger[] = [];
  
  if (hashChanged) {
    triggers.push({
      type: "command_change",
      description: "Skill content has changed since last validation",
      affectedFiles: [skillPath],
      severity: "high",
      detectedAt: now,
    });
  }
  
  if (daysSinceValidation > 30) {
    triggers.push({
      type: "time_based",
      description: `Validation older than 30 days (${Math.floor(daysSinceValidation)} days)`,
      affectedFiles: [skillPath],
      severity: "medium",
      detectedAt: now,
    });
  }
  
  // Check for command/config changes in project
  const projectTriggers = await detectProjectChanges(paths, index, skillPath);
  triggers.push(...projectTriggers);
  
  const isFresh = triggers.length === 0 && index.status === "current";
  const validationRequired = triggers.some(t => t.severity === "high" || t.severity === "critical") || index.status !== "current";
  
  const recommendedActions: string[] = [];
  if (hashChanged) recommendedActions.push("Re-validate skill against current project commands");
  if (daysSinceValidation > 30) recommendedActions.push("Run validation procedure to refresh skill");
  if (projectTriggers.length > 0) recommendedActions.push("Review project changes that may affect verification");
  if (index.status === "stale") recommendedActions.push("Run full validation to update skill status");
  if (index.status === "missing") recommendedActions.push("Skill file missing - recreate or update path");
  if (index.status === "unknown") recommendedActions.push("Skill validation status unknown - run validation");
  
  return {
    skillPath,
    index,
    isFresh,
    triggers,
    lastValidated: index.lastValidated,
    daysSinceValidation: Math.floor(daysSinceValidation),
    contentHash: index.contentHash,
    currentHash,
    hashChanged,
    validationRequired,
    recommendedActions,
  };
}

async function detectProjectChanges(
  paths: VstackPaths,
  index: ProjectVerificationIndex,
  skillPath: string
): Promise<MaintenanceTrigger[]> {
  const triggers: MaintenanceTrigger[] = [];
  const now = new Date().toISOString();
  
  try {
    const projectRoot = index.projectPath;
    
    // Check package.json scripts
    const packageJsonPath = resolve(projectRoot, "package.json");
    if (existsSync(packageJsonPath)) {
      const stats = statSync(packageJsonPath);
      if (stats.mtime > new Date(index.lastValidated)) {
        triggers.push({
          type: "command_change",
          description: "package.json modified since last validation - scripts may have changed",
          affectedFiles: [packageJsonPath],
          severity: "medium",
          detectedAt: now,
        });
      }
    }
    
    // Check config files
    for (const configFile of index.surfaceCoverage) {
      const configPath = resolve(projectRoot, configFile);
      if (existsSync(configPath)) {
        const stats = statSync(configPath);
        if (stats.mtime > new Date(index.lastValidated)) {
          triggers.push({
            type: "config_change",
            description: `Config file ${configFile} modified since last validation`,
            affectedFiles: [configPath],
            severity: "medium",
            detectedAt: now,
          });
        }
      }
    }
    
    // Check test files
    const testDirs = ["tests", "test", "__tests__", "spec"];
    for (const testDir of testDirs) {
      const testPath = resolve(projectRoot, testDir);
      if (existsSync(testPath)) {
        const stats = statSync(testPath);
        if (stats.mtime > new Date(index.lastValidated)) {
          triggers.push({
            type: "test_change",
            description: `Test directory ${testDir} modified since last validation`,
            affectedFiles: [testPath],
            severity: "low",
            detectedAt: now,
          });
        }
      }
    }
    
    // Check entry points
    for (const entry of index.surfaceCoverage) {
      const entryPath = resolve(projectRoot, entry);
      if (existsSync(entryPath)) {
        const stats = statSync(entryPath);
        if (stats.mtime > new Date(index.lastValidated)) {
          triggers.push({
            type: "entry_point_change",
            description: `Entry point ${entry} modified since last validation`,
            affectedFiles: [entryPath],
            severity: "medium",
            detectedAt: now,
          });
        }
      }
    }
    
  } catch {
    // Ignore errors in detection
  }
  
  return triggers;
}

export async function runValidationProcedure(
  skillPath: string,
  procedures: ValidationProcedure[],
  workingDirectory: string = process.cwd()
): Promise<{ passed: boolean; results: Array<{ procedure: string; passed: boolean; output: string }> }> {
  const results: Array<{ procedure: string; passed: boolean; output: string }> = [];
  let allPassed = true;
  
  for (const proc of procedures) {
    try {
      const { executeCommand } = await import("../quality/execution-adapter.js");
      const result = await executeCommand(proc.command, {
        workingDirectory,
        timeoutMs: proc.timeoutMs || 60000,
      });
      
      const passed = result.exitCode === 0 && !result.timedOut;
      results.push({
        procedure: proc.name,
        passed,
        output: result.stdout + result.stderr,
      });
      
      if (!passed) allPassed = false;
    } catch (error) {
      results.push({
        procedure: proc.name,
        passed: false,
        output: error instanceof Error ? error.message : String(error),
      });
      allPassed = false;
    }
  }
  
  return { passed: allPassed, results };
}

export async function runSmokeTest(
  skillPath: string,
  testCommand: string[],
  workingDirectory: string
): Promise<SmokeTestResult> {
  const startTime = Date.now();
  try {
    const { executeCommand } = await import("../quality/execution-adapter.js");
    const result = await executeCommand(testCommand, {
      workingDirectory,
      timeoutMs: 120000,
    });
    
    return {
      passed: result.exitCode === 0 && !result.timedOut,
      output: result.stdout + result.stderr,
      durationMs: Date.now() - startTime,
      errors: result.timedOut ? ["Test timed out"] : (result.exitCode !== 0 ? [`Exit code: ${result.exitCode}`] : []),
    };
  } catch (error) {
    return {
      passed: false,
      output: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function computeFileHash(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "unreadable";
  }
}

export async function updateVerificationIndexAfterValidation(
  verificationIndexStore: any,
  indexId: string,
  validationResult: { passed: boolean; evidence: string[] }
): Promise<ProjectVerificationIndex | null> {
  const updates = {
    lastValidated: new Date().toISOString(),
    validationEvidence: validationResult.evidence,
    status: validationResult.passed ? "current" : "stale",
    gaps: validationResult.passed ? [] : ["Validation failed - see evidence"],
  };
  
  return verificationIndexStore.updateIndex(indexId, updates);
}