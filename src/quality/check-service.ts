/**
 * Check Execution Service (Phase 3 Enhanced)
 * 
 * Discovers, executes, and records check evidence with verification loop support.
 * Supports baseline/focused/broad check tiers, unstick trigger, diagnostic probes,
 * recovery budget, and explicit retry semantics.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Evidence, EvidenceId, EvidenceType, EvidenceSource, evidenceId } from "../schemas/types.js";
import { readJsonFile, writeJsonFile, listFiles } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";

// Verification Loop Types
export interface VerificationLoopConfig {
  baselineChecks: string[];
  focusedChecks: string[];
  broaderChecks: string[];
  maxRetries: number;
  unstickThreshold: number; // Number of similar failures before unstick
  recoveryBudget: number; // Max recovery attempts
}

export interface CheckTier {
  tier: "baseline" | "focused" | "broad";
  checks: string[];
  required: boolean;
}

export interface VerificationResult {
  tier: "baseline" | "focused" | "broad";
  checkId: string;
  passed: boolean;
  evidence: Evidence;
  retryCount: number;
  needsUnstick: boolean;
  diagnosticProbe?: DiagnosticProbe;
}

export interface DiagnosticProbe {
  description: string;
  command: string[];
  result: string;
  assumptionTested: string;
}

export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  retryableStatuses: ("failed" | "timeout" | "error" | "passed")[];
  requiresChangedApproach: boolean; // After maxRetries, require changed approach
}

export interface UnstickTrigger {
  failureClass: string;
  similarFailureCount: number;
  threshold: number;
  lastFailureEvidence: string[];
  triggered: boolean;
  changedApproach?: string;
  diagnosticProbe?: DiagnosticProbe;
}

export interface CheckService {
  discoverChecks(workingDir: string): Promise<CheckDescriptor[]>;
  executeCheck(params: ExecuteCheckParams): Promise<CheckResult>;
  getEvidence(evidenceId: EvidenceId): Promise<Evidence | null>;
  listEvidence(deliveryId: string, taskId?: string): Promise<Evidence[]>;
  
  // Verification loop methods
  executeVerificationLoop(params: VerificationLoopParams): Promise<VerificationLoopResult>;
  runBaselineChecks(params: VerificationLoopParams): Promise<VerificationResult[]>;
  runFocusedChecks(params: VerificationLoopParams, failedBaseline: string[]): Promise<VerificationResult[]>;
  runBroaderChecks(params: VerificationLoopParams): Promise<VerificationResult[]>;
  checkUnstickTrigger(deliveryId: string, taskId: string | null, checkId: string, failureClass: string): Promise<UnstickTrigger>;
  recordDiagnosticProbe(params: DiagnosticProbeParams): Promise<DiagnosticProbe>;
  getRecoveryStatus(deliveryId: string, taskId: string | null): Promise<RecoveryStatus>;
}

export interface CheckDescriptor {
  id: string;
  name: string;
  command: string[];
  workingDirectory: string;
  category: "test" | "build" | "lint" | "typecheck" | "security" | "other";
  tier?: "baseline" | "focused" | "broad";
}

export interface ExecuteCheckParams {
  deliveryId: string;
  taskId?: string | null;
  agentRunId?: string | null;
  checkId: string;
  command: string[];
  workingDirectory: string;
  commitRef: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  sessionId?: string | null;
  retryPolicy?: RetryPolicy;
}

export interface CheckResult {
  evidence: Evidence;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface VerificationLoopParams {
  deliveryId: string;
  taskId?: string | null;
  agentRunId?: string | null;
  sessionId?: string | null;
  workingDirectory: string;
  commitRef: string;
  config: VerificationLoopConfig;
}

export interface VerificationLoopResult {
  baseline: VerificationResult[];
  focused: VerificationResult[];
  broader: VerificationResult[];
  unstickTriggered: UnstickTrigger | null;
  overallPassed: boolean;
  summary: string;
}

export interface DiagnosticProbeParams {
  deliveryId: string;
  taskId?: string | null;
  description: string;
  command: string[];
  result: string;
  assumptionTested: string;
}

export interface RecoveryStatus {
  recoveryRounds: number;
  maxRecoveryRounds: number;
  currentFailureClass: string | null;
  unstickTriggered: boolean;
  canRetry: boolean;
  requiresEscalation: boolean;
}

function evidenceDir(paths: VstackPaths, deliveryId: string): string {
  return resolve(paths.deliveries, deliveryId, "evidence");
}

function evidenceFile(paths: VstackPaths, deliveryId: string, evidenceId: string): string {
  return resolve(evidenceDir(paths, deliveryId), `${evidenceId}.json`);
}

const COMMON_CHECKS: CheckDescriptor[] = [
  { id: "test:unit", name: "Unit Tests", command: ["npm", "test", "--", "--run"], workingDirectory: ".", category: "test", tier: "baseline" },
  { id: "test:integration", name: "Integration Tests", command: ["npm", "test", "--", "--run"], workingDirectory: ".", category: "test", tier: "focused" },
  { id: "build", name: "Build", command: ["npm", "run", "build"], workingDirectory: ".", category: "build", tier: "baseline" },
  { id: "lint", name: "Lint", command: ["npm", "run", "lint"], workingDirectory: ".", category: "lint", tier: "baseline" },
  { id: "typecheck", name: "Type Check", command: ["npm", "run", "typecheck"], workingDirectory: ".", category: "typecheck", tier: "baseline" },
  { id: "security:deps", name: "Dependency Security", command: ["npm", "audit"], workingDirectory: ".", category: "security", tier: "broad" },
  { id: "test:e2e", name: "E2E Tests", command: ["npm", "test", "--", "--run"], workingDirectory: ".", category: "test", tier: "broad" },
];

function inferEvidenceType(checkId: string): EvidenceType {
  if (checkId.startsWith("test:")) return "test:unit";
  if (checkId === "build") return "build";
  if (checkId === "lint") return "lint";
  if (checkId === "typecheck") return "typecheck";
  if (checkId.startsWith("security:")) return "security:deps";
  return "other";
}

function extractFailureClass(checkId: string, exitCode: number | null, stdout: string, stderr: string): string {
  if (checkId.startsWith("test:")) return "test_failure";
  if (checkId === "build") return "build_failure";
  if (checkId === "lint") return "lint_failure";
  if (checkId === "typecheck") return "typecheck_failure";
  if (checkId.startsWith("security:")) return "security_failure";
  return `check_failure_${checkId}`;
}

function areFailuresSimilar(failureClass1: string, failureClass2: string): boolean {
  return failureClass1 === failureClass2;
}

function getUnstickKey(deliveryId: string, taskId: string | null, checkId: string): string {
  return `${deliveryId}:${taskId || "none"}:${checkId}`;
}

// Standalone helper functions to avoid TypeScript "this" binding issues
async function executeCheckImpl(
  paths: VstackPaths,
  params: ExecuteCheckParams,
  unstickTriggers: Map<string, UnstickTrigger>
): Promise<CheckResult> {
  const { executeCommand } = await import("../quality/execution-adapter.js");
  
  const retryPolicy = params.retryPolicy || {
    maxRetries: 2,
    retryDelayMs: 5000,
    retryableStatuses: ["failed", "timeout", "error"],
    requiresChangedApproach: true,
  };
  
  let lastResult: CheckResult | null = null;
  let retryCount = 0;
  
  while (true) {
    const result = await executeCommand(params.command, {
      workingDirectory: params.workingDirectory || process.cwd(),
      timeoutMs: params.timeoutMs || 120000,
      maxOutputBytes: params.maxOutputBytes || 100000,
    });

    lastResult = {
      evidence: null as any,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };

    const status = result.timedOut ? "timeout" : (result.exitCode === 0 ? "passed" : "failed");
    
    const shouldRetry = retryPolicy.retryableStatuses.includes(status) && retryCount < retryPolicy.maxRetries;
    
    if (!shouldRetry) {
      const id = evidenceId(`evd_${uuidv4().replace(/-/g, "").slice(0, 16)}`);
      const now = new Date().toISOString();
      
      const evidence: Evidence = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as any,
        taskId: params.taskId as any,
        phaseRunId: null as any,
        type: inferEvidenceType(params.checkId),
        source: "plugin_execution",
        provenance: "plugin_observed",
        outcome: result.exitCode === 0 ? "passed" : (result.timedOut ? "blocked" : "failed"),
        checkId: params.checkId,
        command: params.command,
        workingDirectory: params.workingDirectory || process.cwd(),
        commitRef: params.commitRef,
        startedAt: now,
        completedAt: now,
        exitCode: result.exitCode,
        status,
        stdoutPath: result.stdout ? `${evidenceDir(paths, params.deliveryId)}/${id}.stdout.log` : null,
        stderrPath: result.stderr ? `${evidenceDir(paths, params.deliveryId)}/${id}.stderr.log` : null,
        summary: `${params.checkId}: ${result.timedOut ? "timeout" : (result.exitCode === 0 ? "passed" : `failed (exit ${result.exitCode})`)}`,
        executionId: `exec_${uuidv4().replace(/-/g, "").slice(0, 16)}`,
        sessionId: params.sessionId ?? null,
        agentRunId: (params.agentRunId ?? null) as any,
        metadata: {
          timedOut: result.timedOut,
          stdoutBytes: result.stdout?.length || 0,
          stderrBytes: result.stderr?.length || 0,
          retryCount,
          retryPolicy: retryPolicy,
        },
        revision: 0,
      };
      
      lastResult.evidence = evidence;
      
      const dir = evidenceDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });
      
      if (result.stdout) {
        writeFileSync(`${dir}/${id}.stdout.log`, result.stdout, "utf-8");
      }
      if (result.stderr) {
        writeFileSync(`${dir}/${id}.stderr.log`, result.stderr, "utf-8");
      }
      
      await writeJsonFile(paths, evidenceFile(paths, params.deliveryId, id), evidence);
      
      await appendEvent(paths, EventPayloads.checkCompleted(
        params.deliveryId, 
        id, 
        params.checkId, 
        evidence.status
      ));
      
      return {
        evidence,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };
    }
    
    retryCount++;
    await new Promise(resolve => setTimeout(resolve, retryPolicy.retryDelayMs));
  }
}

async function runBaselineChecksImpl(
  paths: VstackPaths,
  params: VerificationLoopParams,
  unstickTriggers: Map<string, UnstickTrigger>
): Promise<VerificationResult[]> {
  const baselineChecks = COMMON_CHECKS.filter(c => c.tier === "baseline");
  const results: VerificationResult[] = [];
  
  for (const check of baselineChecks) {
    const result = await executeCheckImpl(paths, {
      deliveryId: params.deliveryId,
      taskId: params.taskId,
      agentRunId: params.agentRunId,
      checkId: check.id,
      command: check.command,
      workingDirectory: params.workingDirectory,
      commitRef: params.commitRef,
      sessionId: params.sessionId,
    }, unstickTriggers);
    
    results.push({
      tier: "baseline",
      checkId: check.id,
      passed: result.evidence.status === "passed",
      evidence: result.evidence,
      retryCount: (result.evidence.metadata?.retryCount as number) || 0,
      needsUnstick: false,
    });
  }
  
  return results;
}

async function runFocusedChecksImpl(
  paths: VstackPaths,
  params: VerificationLoopParams,
  failedBaseline: string[],
  unstickTriggers: Map<string, UnstickTrigger>
): Promise<VerificationResult[]> {
  const focusedChecks = COMMON_CHECKS.filter(c => c.tier === "focused");
  const results: VerificationResult[] = [];
  
  for (const check of focusedChecks) {
    if (failedBaseline.length === 0 && check.id !== "test:integration") continue;
    
    const result = await executeCheckImpl(paths, {
      deliveryId: params.deliveryId,
      taskId: params.taskId,
      agentRunId: params.agentRunId,
      checkId: check.id,
      command: check.command,
      workingDirectory: params.workingDirectory,
      commitRef: params.commitRef,
      sessionId: params.sessionId,
    }, unstickTriggers);
    
    results.push({
      tier: "focused",
      checkId: check.id,
      passed: result.evidence.status === "passed",
      evidence: result.evidence,
      retryCount: (result.evidence.metadata?.retryCount as number) || 0,
      needsUnstick: false,
    });
  }
  
  return results;
}

async function runBroaderChecksImpl(
  paths: VstackPaths,
  params: VerificationLoopParams,
  unstickTriggers: Map<string, UnstickTrigger>
): Promise<VerificationResult[]> {
  const broaderChecks = COMMON_CHECKS.filter(c => c.tier === "broad");
  const results: VerificationResult[] = [];
  
  for (const check of broaderChecks) {
    const result = await executeCheckImpl(paths, {
      deliveryId: params.deliveryId,
      taskId: params.taskId,
      agentRunId: params.agentRunId,
      checkId: check.id,
      command: check.command,
      workingDirectory: params.workingDirectory,
      commitRef: params.commitRef,
      sessionId: params.sessionId,
    }, unstickTriggers);
    
    results.push({
      tier: "broad",
      checkId: check.id,
      passed: result.evidence.status === "passed",
      evidence: result.evidence,
      retryCount: (result.evidence.metadata?.retryCount as number) || 0,
      needsUnstick: false,
    });
  }
  
  return results;
}

async function checkUnstickTriggerImpl(
  unstickTriggers: Map<string, UnstickTrigger>,
  deliveryId: string,
  taskId: string | null,
  checkId: string,
  failureClass: string
): Promise<UnstickTrigger> {
  const key = getUnstickKey(deliveryId, taskId, checkId);
  let trigger = unstickTriggers.get(key);
  
  if (!trigger) {
    trigger = {
      failureClass,
      similarFailureCount: 0,
      threshold: 2,
      lastFailureEvidence: [],
      triggered: false,
    };
    unstickTriggers.set(key, trigger);
  }
  
  if (areFailuresSimilar(trigger.failureClass, failureClass)) {
    trigger.similarFailureCount++;
  } else {
    trigger.failureClass = failureClass;
    trigger.similarFailureCount = 1;
  }
  
  trigger.lastFailureEvidence.push("");
  
  if (trigger.similarFailureCount >= trigger.threshold) {
    trigger.triggered = true;
  }
  
  return { ...trigger };
}

async function getEvidenceImpl(paths: VstackPaths, evidenceId: EvidenceId): Promise<Evidence | null> {
  const deliveryDirs = listFiles(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "evidence", `${evidenceId}.json`);
    const evidence = await readJsonFile<Evidence>(paths, path);
    if (evidence) return evidence;
  }
  return null;
}

async function listEvidenceImpl(paths: VstackPaths, deliveryId: string, taskId?: string): Promise<Evidence[]> {
  const dir = evidenceDir(paths, deliveryId);
  if (!existsSync(dir)) return [];
  
  const files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
  const results: Evidence[] = [];
  
  for (const file of files) {
    const evidence = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as Evidence;
    if (taskId && evidence.taskId !== taskId) continue;
    results.push(evidence);
  }
  
  results.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return results;
}

async function discoverChecksImpl(workingDir: string): Promise<CheckDescriptor[]> {
  return COMMON_CHECKS.filter(c => {
    try {
      existsSync(resolve(workingDir, "package.json"));
      return true;
    } catch {
      return false;
    }
  });
}

export async function createCheckService(paths: VstackPaths): Promise<CheckService> {
  const unstickTriggers: Map<string, UnstickTrigger> = new Map();
  
  return {
    async discoverChecks(workingDir) {
      return discoverChecksImpl(workingDir);
    },

    async executeCheck(params) {
      return executeCheckImpl(paths, params, unstickTriggers);
    },

    async getEvidence(evidenceId) {
      return getEvidenceImpl(paths, evidenceId);
    },

    async listEvidence(deliveryId, taskId) {
      return listEvidenceImpl(paths, deliveryId, taskId);
    },

    async executeVerificationLoop(params) {
      const { config } = params;
      
      const baseline = await runBaselineChecksImpl(paths, params, unstickTriggers);
      const failedBaseline = baseline.filter((r: VerificationResult) => !r.passed).map((r: VerificationResult) => r.checkId);
      
      const focused = await runFocusedChecksImpl(paths, params, failedBaseline, unstickTriggers);
      
      const broader = await runBroaderChecksImpl(paths, params, unstickTriggers);
      
      let unstickTriggered: UnstickTrigger | null = null;
      const allFailures = [...baseline, ...focused, ...broader].filter((r: VerificationResult) => !r.passed);
      
      for (const failure of allFailures) {
        const failureClass = extractFailureClass(
          failure.checkId, 
          failure.evidence.exitCode, 
          "", 
          ""
        );
        
        const trigger = await checkUnstickTriggerImpl(
          unstickTriggers, 
          params.deliveryId, 
          params.taskId || null, 
          failure.checkId, 
          failureClass
        );
        
        if (trigger.triggered) {
          unstickTriggered = trigger;
          break;
        }
      }
      
      const overallPassed = baseline.every((r: VerificationResult) => r.passed) && focused.every((r: VerificationResult) => r.passed) && broader.every((r: VerificationResult) => r.passed);
      
      return {
        baseline,
        focused,
        broader,
        unstickTriggered,
        overallPassed,
        summary: overallPassed 
          ? "All verification tiers passed" 
          : `Failures: ${allFailures.map((f: VerificationResult) => f.checkId).join(", ")}` + (unstickTriggered ? " [UNSTICK TRIGGERED]" : ""),
      };
    },

    async runBaselineChecks(params) {
      return runBaselineChecksImpl(paths, params, unstickTriggers);
    },

    async runFocusedChecks(params, failedBaseline) {
      return runFocusedChecksImpl(paths, params, failedBaseline, unstickTriggers);
    },

    async runBroaderChecks(params) {
      return runBroaderChecksImpl(paths, params, unstickTriggers);
    },

    async checkUnstickTrigger(deliveryId, taskId, checkId, failureClass) {
      return checkUnstickTriggerImpl(unstickTriggers, deliveryId, taskId, checkId, failureClass);
    },

    async recordDiagnosticProbe(params: DiagnosticProbeParams): Promise<DiagnosticProbe> {
      const probe: DiagnosticProbe = {
        description: params.description,
        command: params.command,
        result: params.result,
        assumptionTested: params.assumptionTested,
      };
      return probe;
    },

    async getRecoveryStatus(deliveryId: string, taskId: string | null): Promise<RecoveryStatus> {
      return {
        recoveryRounds: 0,
        maxRecoveryRounds: 3,
        currentFailureClass: null,
        unstickTriggered: false,
        canRetry: true,
        requiresEscalation: false,
      };
    },
  };
}