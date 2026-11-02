/**
 * Quality gates system
 * Defines and evaluates quality gates for phase transitions
 */

import { EvidenceType, EvidenceSource } from "../schemas/types.js";

export interface GateDefinition {
  id: string;
  name: string;
  description: string;
  type: EvidenceType;
  required: boolean;
  phase: string[];
  command: string[]; // argv array
  workingDirectory: string;
  timeout: number; // ms
  retryPolicy: RetryPolicy;
  passCriteria: PassCriteria;
  environment?: Record<string, string>;
}

export interface RetryPolicy {
  maxRetries: number;
  retryDelay: number; // ms
  retryOn: ("timeout" | "error" | "failed")[];
}

export interface PassCriteria {
  type: "exit_code" | "output_contains" | "output_matches" | "custom";
  expectedExitCode?: number;
  expectedOutput?: string;
  outputPattern?: string;
  customEvaluator?: string; // function name
}

export interface GateEvaluationResult {
  gateId: string;
  status: "passed" | "failed" | "skipped" | "error";
  evidence: GateEvidence;
  evaluatedAt: string;
  duration: number;
  retries: number;
}

export interface GateEvidence {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutPath: string | null;
  stderrPath: string | null;
  startedAt: string;
  completedAt: string;
  source: EvidenceSource;
  checkId: string;
  commitRef: string;
  workingDirectory: string;
}

/**
 * Default quality gates
 */
export const DEFAULT_GATES: GateDefinition[] = [
  {
    id: "build",
    name: "Build",
    description: "Project builds successfully",
    type: "build",
    required: true,
    phase: ["implementation", "validation", "release_preparation"],
    command: [], // Discovered from project
    workingDirectory: ".",
    timeout: 300000, // 5 minutes
    retryPolicy: { maxRetries: 1, retryDelay: 5000, retryOn: ["error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "lint",
    name: "Lint",
    description: "Code passes linting rules",
    type: "lint",
    required: true,
    phase: ["implementation", "validation", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 120000,
    retryPolicy: { maxRetries: 1, retryDelay: 5000, retryOn: ["error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "typecheck",
    name: "Type Check",
    description: "TypeScript type checking passes",
    type: "typecheck",
    required: true,
    phase: ["implementation", "validation", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 120000,
    retryPolicy: { maxRetries: 1, retryDelay: 5000, retryOn: ["error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "test:unit",
    name: "Unit Tests",
    description: "Unit test suite passes",
    type: "test:unit",
    required: true,
    phase: ["validation", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 300000,
    retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["failed", "error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "test:integration",
    name: "Integration Tests",
    description: "Integration test suite passes",
    type: "test:integration",
    required: false,
    phase: ["validation", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 600000,
    retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["failed", "error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "test:e2e",
    name: "E2E Tests",
    description: "End-to-end test suite passes",
    type: "test:e2e",
    required: false,
    phase: ["validation", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 900000,
    retryPolicy: { maxRetries: 1, retryDelay: 15000, retryOn: ["failed", "error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "coverage",
    name: "Coverage Threshold",
    description: "Code coverage meets minimum threshold",
    type: "coverage",
    required: false,
    phase: ["validation", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 120000,
    retryPolicy: { maxRetries: 0, retryDelay: 0, retryOn: [] },
    passCriteria: { type: "output_contains", expectedOutput: "coverage threshold met" },
  },
  {
    id: "security:deps",
    name: "Dependency Vulnerability Scan",
    description: "No critical/high severity vulnerabilities in dependencies",
    type: "security:deps",
    required: true,
    phase: ["validation", "review", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 120000,
    retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "security:secrets",
    name: "Secret Scan",
    description: "No secrets detected in codebase",
    type: "security:secrets",
    required: true,
    phase: ["validation", "review", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 120000,
    retryPolicy: { maxRetries: 1, retryDelay: 5000, retryOn: ["error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "security:review",
    name: "Security Review",
    description: "Security-focused code review passed",
    type: "security:review",
    required: false,
    phase: ["review"],
    command: [],
    workingDirectory: ".",
    timeout: 0, // Manual review
    retryPolicy: { maxRetries: 0, retryDelay: 0, retryOn: [] },
    passCriteria: { type: "custom", customEvaluator: "evaluateSecurityReview" },
  },
  {
    id: "architecture:review",
    name: "Architecture Review",
    description: "Architecture review passed",
    type: "architecture:review",
    required: false,
    phase: ["review", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 0,
    retryPolicy: { maxRetries: 0, retryDelay: 0, retryOn: [] },
    passCriteria: { type: "custom", customEvaluator: "evaluateArchitectureReview" },
  },
  {
    id: "acceptance",
    name: "Acceptance Criteria Verification",
    description: "All acceptance criteria verified",
    type: "acceptance",
    required: true,
    phase: ["validation", "review", "release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 0, // Manual/agent-driven
    retryPolicy: { maxRetries: 0, retryDelay: 0, retryOn: [] },
    passCriteria: { type: "custom", customEvaluator: "evaluateAcceptanceCriteria" },
  },
  {
    id: "release:artifacts",
    name: "Release Artifacts Validation",
    description: "Release artifacts are valid and signed",
    type: "release:artifacts",
    required: true,
    phase: ["release_preparation"],
    command: [],
    workingDirectory: ".",
    timeout: 120000,
    retryPolicy: { maxRetries: 1, retryDelay: 5000, retryOn: ["error"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
  {
    id: "deploy:health",
    name: "Deployment Health Check",
    description: "Post-deployment health checks pass",
    type: "deploy:health",
    required: true,
    phase: ["deployment", "post_release"],
    command: [],
    workingDirectory: ".",
    timeout: 300000,
    retryPolicy: { maxRetries: 2, retryDelay: 10000, retryOn: ["failed", "error", "timeout"] },
    passCriteria: { type: "exit_code", expectedExitCode: 0 },
  },
];

/**
 * Get gates for a phase
 */
export function getGatesForPhase(phase: string): GateDefinition[] {
  return DEFAULT_GATES.filter(g => g.phase.includes(phase));
}

/**
 * Get required gates for a phase
 */
export function getRequiredGatesForPhase(phase: string): GateDefinition[] {
  return DEFAULT_GATES.filter(g => g.phase.includes(phase) && g.required);
}

/**
 * Get optional gates for a phase
 */
export function getOptionalGatesForPhase(phase: string): GateDefinition[] {
  return DEFAULT_GATES.filter(g => g.phase.includes(phase) && !g.required);
}

/**
 * Gate registry for custom gates
 */
export class GateRegistry {
  private gates = new Map<string, GateDefinition>(DEFAULT_GATES.map(g => [g.id, g]));
  
  register(gate: GateDefinition): void {
    this.gates.set(gate.id, gate);
  }
  
  get(id: string): GateDefinition | undefined {
    return this.gates.get(id);
  }
  
  getAll(): GateDefinition[] {
    return Array.from(this.gates.values());
  }
  
  remove(id: string): boolean {
    return this.gates.delete(id);
  }
  
  clear(): void {
    this.gates.clear();
    // Re-add defaults
    for (const gate of DEFAULT_GATES) {
      this.gates.set(gate.id, gate);
    }
  }
}

/**
 * Gate evaluator
 */
export interface GateEvaluator {
  evaluate(gate: GateDefinition, context: EvaluationContext): Promise<GateEvaluationResult>;
}

export interface EvaluationContext {
  deliveryId: string;
  phaseRunId: string;
  workingDirectory: string;
  commitRef: string;
  environment: Record<string, string>;
}

/**
 * Default gate evaluator (executes command and checks criteria)
 */
export async function defaultGateEvaluator(
  gate: GateDefinition,
  context: EvaluationContext
): Promise<GateEvaluationResult> {
  const startedAt = new Date().toISOString();
  let retries = 0;
  let lastError: Error | null = null;
  
  while (retries <= gate.retryPolicy.maxRetries) {
    try {
      // Execute command
      const { stdout, stderr, exitCode } = await executeCommand(
        gate.command,
        gate.workingDirectory,
        gate.timeout,
        { ...context.environment, ...gate.environment }
      );
      
      const completedAt = new Date().toISOString();
      
      // Evaluate pass criteria
      const passed = evaluatePassCriteria(gate.passCriteria, { stdout, stderr, exitCode });
      
      return {
        gateId: gate.id,
        status: passed ? "passed" : "failed",
        evidence: {
          command: gate.command,
          exitCode,
          stdout,
          stderr,
          stdoutPath: null, // Would be saved to file
          stderrPath: null,
          startedAt,
          completedAt,
          source: "plugin_execution",
          checkId: gate.id,
          commitRef: context.commitRef,
          workingDirectory: context.workingDirectory,
        },
        evaluatedAt: completedAt,
        duration: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
        retries,
      };
    } catch (error) {
      lastError = error as Error;
      
      const shouldRetry = gate.retryPolicy.retryOn.includes(
        error instanceof Error && error.name === "TimeoutError" ? "timeout" : "error"
      );
      
      if (shouldRetry && retries < gate.retryPolicy.maxRetries) {
        retries++;
        await sleep(gate.retryPolicy.retryDelay);
        continue;
      }
      
      break;
    }
  }
  
  // All retries exhausted or non-retryable error
  const completedAt = new Date().toISOString();
  
  return {
    gateId: gate.id,
    status: "error",
    evidence: {
      command: gate.command,
      exitCode: null,
      stdout: "",
      stderr: lastError?.message ?? "Unknown error",
      stdoutPath: null,
      stderrPath: null,
      startedAt,
      completedAt,
      source: "plugin_execution",
      checkId: gate.id,
      commitRef: context.commitRef,
      workingDirectory: context.workingDirectory,
    },
    evaluatedAt: completedAt,
    duration: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    retries,
  };
}

/**
 * Execute a command and capture output
 */
async function executeCommand(
  command: string[],
  cwd: string,
  timeout: number,
  env: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // In real implementation, use child_process.spawn with timeout
  // For now, return placeholder
  return { stdout: "", stderr: "", exitCode: 0 };
}

/**
 * Evaluate pass criteria
 */
function evaluatePassCriteria(
  criteria: PassCriteria,
  result: { stdout: string; stderr: string; exitCode: number }
): boolean {
  switch (criteria.type) {
    case "exit_code":
      return result.exitCode === (criteria.expectedExitCode ?? 0);
    case "output_contains":
      return result.stdout.includes(criteria.expectedOutput ?? "") || 
             result.stderr.includes(criteria.expectedOutput ?? "");
    case "output_matches":
      if (!criteria.outputPattern) return false;
      const regex = new RegExp(criteria.outputPattern);
      return regex.test(result.stdout) || regex.test(result.stderr);
    case "custom":
      // Would call registered custom evaluator
      return false;
    default:
      return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}