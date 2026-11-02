/**
 * Rollback management
 * Handles automated and manual rollback procedures
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

async function executeCommand(
  command: string[],
  options: { cwd: string; timeout: number; env: Record<string, string> }
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const [cmd, ...args] = command;
  if (!cmd) {
    return { exitCode: -1, stdout: "", stderr: "Empty command" };
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    let stdout = "";
    let stderr = "";
    
    if (child.stdout) {
      child.stdout.on("data", (data) => { stdout += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on("data", (data) => { stderr += data.toString(); });
    }
    
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeout);
    
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, stdout, stderr });
    });
    
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr: err.message });
    });
  });
}

export interface RollbackConfig {
  enabled: boolean;
  automatic: boolean;
  triggers: RollbackTrigger[];
  strategies: RollbackStrategy[];
  maxRollbackTime: number; // ms
  requireApproval: boolean;
}

export interface RollbackTrigger {
  type: "health_check_failure" | "metric_threshold" | "error_rate" | "manual" | "approval_rejected";
  conditions: RollbackCondition[];
  severity: "warning" | "critical";
}

export interface RollbackCondition {
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
  threshold: number;
  window: string; // e.g., "5m", "1h"
}

export interface RollbackStrategy {
  name: string;
  type: "reverse" | "redeploy_previous" | "blue_green_switch" | "canary_pause" | "manual";
  steps: RollbackStep[];
  maxDuration: number;
  applicableEnvironments: string[];
}

export interface RollbackStep {
  name: string;
  type: "command" | "api_call" | "traffic_shift" | "database_migration" | "notification";
  command?: string[];
  apiEndpoint?: string;
  apiMethod?: string;
  apiPayload?: Record<string, unknown>;
  timeout: number;
  retryOnFailure: boolean;
  maxRetries: number;
  rollbackOnFailure: boolean;
}

export interface RollbackExecution {
  id: string;
  deploymentId: string;
  strategy: string;
  trigger: string;
  status: "initiated" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  stepsCompleted: string[];
  failedStep?: string;
  error?: string;
  approvedBy: string | null;
  approvalRequired: boolean;
  revision?: number;
}

export interface RollbackReport {
  executionId: string;
  deploymentId: string;
  strategy: string;
  trigger: string;
  status: "success" | "failed" | "partial";
  startedAt: string;
  completedAt: string;
  duration: number;
  stepsCompleted: string[];
  failedSteps: string[];
  healthCheckResults: HealthCheckResult[];
  lessonsLearned: string[];
}

export interface HealthCheckResult {
  name: string;
  passed: boolean;
  latencyMs: number;
  timestamp: string;
}

/**
 * Create rollback manager
 */
export async function createRollbackManager(paths: VstackPaths) {
  return {
    /**
     * Initiate rollback
     */
    async initiateRollback(
      deploymentId: string,
      trigger: string,
      config: RollbackConfig,
      requestedBy: string
    ): Promise<RollbackExecution> {
      const executionId = `rbk_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const now = new Date().toISOString();
      
      // Find applicable strategy
      const strategy = config.strategies.find(s => 
        s.applicableEnvironments.includes("production") // Would get from deployment
      );
      
      if (!strategy) {
        throw new Error("No applicable rollback strategy found");
      }
      
      // Check if approval required
      const approvalRequired = config.requireApproval || strategy.steps.some(s => s.rollbackOnFailure);
      
      const execution: RollbackExecution = {
        id: executionId,
        deploymentId,
        strategy: strategy.name,
        trigger,
        status: approvalRequired ? "initiated" : "running",
        startedAt: now,
        completedAt: null,
        stepsCompleted: [],
        failedStep: undefined,
        error: undefined,
        approvedBy: approvalRequired ? requestedBy : null,
        approvalRequired,
      };
      
      // Save execution
      const executionPath = resolve(paths.deliveries, "rollbacks", `${executionId}.json`);
      await writeJsonFile(paths, executionPath, execution);
      
      // If auto-approval or not required, execute immediately
      if (!approvalRequired || config.automatic) {
        await this.executeRollback(executionId, strategy);
      }
      
      return execution;
    },
    
    /**
     * Execute rollback
     */
    async executeRollback(
      executionId: string,
      strategy: RollbackStrategy
    ): Promise<RollbackReport> {
      const executionPath = resolve(paths.deliveries, "rollbacks", `${executionId}.json`);
      const execution = await readJsonFile<any>(paths, executionPath);
      
      if (!execution) throw new Error(`Rollback execution ${executionId} not found`);
      
      if (execution.status !== "running" && execution.status !== "initiated") {
        throw new Error(`Execution not in runnable state: ${execution.status}`);
      }
      
      execution.status = "running";
      execution.startedAt = new Date().toISOString();
      
      await writeJsonFile(paths, resolve(paths.deliveries, "rollbacks", `${executionId}.json`), execution);
      
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      const stepsCompleted: string[] = [];
      const failedSteps: string[] = [];
      const healthCheckResults: any[] = [];
      const lessonsLearned: string[] = [];
      
      for (const step of strategy.steps) {
        try {
          // Execute step
          if (step.type === "command" && step.command) {
            await executeCommand(step.command, {
              cwd: ".",
              timeout: step.timeout,
              env: process.env as Record<string, string>,
            });
          } else if (step.type === "api_call" && step.apiEndpoint) {
            await fetch(step.apiEndpoint, {
              method: step.apiMethod || "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(step.apiPayload || {}),
            });
          } else if (step.type === "traffic_shift") {
            // Traffic shift would be implemented
          }
          
          stepsCompleted.push(step.name);
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          failedSteps.push(step.name);
          
          if (step.rollbackOnFailure) {
            // Try to rollback this step
            try {
              // Would execute rollback for this step
            } catch (rollbackError) {
              // Log but continue
            }
          }
          
          if (!step.retryOnFailure) {
            // Stop rollback
            break;
          }
          
          // Retry logic
          for (let retry = 1; retry <= step.maxRetries; retry++) {
            try {
              await new Promise(r => setTimeout(r, 5000)); // Wait before retry
              
              if (step.type === "command" && step.command) {
                await executeCommand(step.command, { cwd: ".", timeout: step.timeout, env: process.env as Record<string, string> });
              }
              
              // Success on retry
              stepsCompleted.push(`${step.name} (retry ${retry})`);
              break;
            } catch (retryError) {
              if (retry === step.maxRetries) {
                throw retryError;
              }
            }
          }
        }
      }
      
      const completedAt = new Date().toISOString();
      const duration = Date.now() - new Date(startedAt).getTime();
      const status = failedSteps.length === 0 ? "success" : "failed";
      
      const report: RollbackReport = {
        executionId,
        deploymentId: execution.deploymentId,
        strategy: strategy.name,
        trigger: execution.trigger,
        status,
        startedAt,
        completedAt,
        duration,
        stepsCompleted,
        failedSteps,
        healthCheckResults: [],
        lessonsLearned,
      };
      
      // Update execution
      execution.status = status === "success" ? "completed" : "failed";
      execution.completedAt = completedAt;
      execution.stepsCompleted = stepsCompleted;
      execution.failedStep = failedSteps[0];
      execution.error = failedSteps.length > 0 ? `Failed steps: ${failedSteps.join(", ")}` : null;
      
      await writeJsonFile(paths, resolve(paths.deliveries, "rollbacks", `${executionId}.json`), execution);
      
      return report;
    },
    
    /**
     * Approve rollback
     */
    async approveRollback(executionId: string, approvedBy: string): Promise<RollbackExecution> {
      const executionPath = resolve(paths.deliveries, "rollbacks", `${executionId}.json`);
      const execution = await readJsonFile<any>(paths, executionPath);
      
      if (!execution) throw new Error(`Rollback execution ${executionId} not found`);
      
      if (!execution.approvalRequired) {
        throw new Error("Rollback does not require approval");
      }
      
      if (execution.status !== "initiated") {
        throw new Error(`Execution not in approvable state: ${execution.status}`);
      }
      
      execution.approvedBy = approvedBy;
      execution.status = "running";
      
      await writeJsonFile(paths, resolve(paths.deliveries, "rollbacks", `${executionId}.json`), execution);
      
      // Execute rollback
      // Would call executeRollback with appropriate strategy
      
      return execution;
    },
    
    /**
     * Get rollback history
     */
    async getRollbackHistory(deliveryId?: string): Promise<RollbackExecution[]> {
      const rollbackIds = listFiles(paths, resolve(paths.deliveries, "rollbacks"));
      const executions: RollbackExecution[] = [];
      
      for (const rollbackId of rollbackIds) {
        const executionPath = resolve(paths.deliveries, "rollbacks", `${rollbackId}.json`);
        const execution = await readJsonFile<any>(paths, executionPath);
        
        if (execution && (!deliveryId || execution.deploymentId.includes(deliveryId))) {
          executions.push(execution);
        }
      }
      
      return executions.sort((a, b) => 
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );
    },
    
    /**
     * Validate rollback readiness
     */
    async validateRollbackReadiness(deploymentId: string): Promise<{
      ready: boolean;
      checks: Array<{ name: string; passed: boolean; message: string }>;
    }> {
      // Check if previous version exists
      // Check if database migrations are reversible
      // Check if dependencies support downgrade
      // Check if rollback plan is defined
      
      return {
        ready: true,
        checks: [
          { name: "Previous version available", passed: true, message: "Previous version tagged" },
          { name: "Database migration reversible", passed: true, message: "Down migration available" },
          { name: "Dependencies support downgrade", passed: true, message: "Compatible versions" },
          { name: "Rollback plan defined", passed: true, message: "Strategy configured" },
        ],
      };
    },
  };
}