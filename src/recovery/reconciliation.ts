/**
 * State reconciliation utilities for vstack workflow
 * Validates and repairs consistency across workflow entities
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Delivery, Task, AgentRun, PhaseRun, ReviewRun, Finding, Evidence, Approval, TaskStatus, PhaseRunStatus, DeliveryStatus, TaskId } from "../schemas/types.js";
import { readJsonFile, listFiles, fileExists, writeJsonFile } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";

export interface ReconciliationResult {
  deliveryId: string;
  checkedAt: string;
  issuesFound: ReconciliationIssue[];
  issuesFixed: ReconciliationIssue[];
  warnings: string[];
}

export interface ReconciliationIssue {
  type: "missing_file" | "orphaned_entity" | "inconsistent_reference" | "missing_evidence" | "cycle_detected" | "schema_violation";
  severity: "error" | "warning" | "info";
  entityType: "delivery" | "phase" | "task" | "agent_run" | "review" | "finding" | "evidence" | "approval";
  entityId: string;
  description: string;
  fixApplied: boolean;
  fixDescription?: string;
}

/**
 * Reconcile all deliveries in the project
 */
export async function reconcileAll(paths: VstackPaths): Promise<ReconciliationResult[]> {
  const results: ReconciliationResult[] = [];
  const deliveryIds = listFiles(paths, paths.deliveries);
  
  for (const deliveryId of deliveryIds) {
    const result = await reconcileDelivery(paths, deliveryId);
    if (result.issuesFound.length > 0 || result.warnings.length > 0) {
      results.push(result);
    }
  }
  
  return results;
}

/**
 * Reconcile a single delivery
 */
export async function reconcileDelivery(paths: VstackPaths, deliveryId: string): Promise<ReconciliationResult> {
  const issuesFound: ReconciliationIssue[] = [];
  const issuesFixed: ReconciliationIssue[] = [];
  const warnings: string[] = [];
  
  // 1. Check delivery file exists and is valid
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  
  if (!delivery) {
    issuesFound.push({
      type: "missing_file",
      severity: "error",
      entityType: "delivery",
      entityId: deliveryId,
      description: "Delivery file missing",
      fixApplied: false,
    });
    return { deliveryId, checkedAt: new Date().toISOString(), issuesFound, issuesFixed, warnings };
  }
  
  // 2. Validate currentPhaseRunId references existing phase run
  if (delivery.currentPhaseRunId) {
    const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`);
    const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
    
    if (!phaseRun) {
      const issue: ReconciliationIssue = {
        type: "inconsistent_reference",
        severity: "error",
        entityType: "phase",
        entityId: delivery.currentPhaseRunId,
        description: `Delivery references missing phase run: ${delivery.currentPhaseRunId}`,
        fixApplied: false,
      };
      issuesFound.push(issue);
      
      // Auto-fix: find latest completed phase run
      const fixed = await fixMissingPhaseRun(paths, deliveryId, delivery);
      if (fixed) {
        issue.fixApplied = true;
        issue.fixDescription = "Updated to latest completed phase run";
        issuesFixed.push(issue);
      }
    }
  }
  
  // 3. Check all phase runs belong to this delivery
  const phaseRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "phases"));
  for (const phaseRunId of phaseRunIds) {
    const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
    const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
    
    if (phaseRun) {
      if (phaseRun.deliveryId !== deliveryId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "error",
          entityType: "phase",
          entityId: phaseRunId,
          description: `Phase run belongs to different delivery: ${phaseRun.deliveryId}`,
          fixApplied: false,
        });
      }
      
      // Validate phase run sequence
      if (phaseRun.runSequence < 1) {
        issuesFound.push({
          type: "schema_violation",
          severity: "warning",
          entityType: "phase",
          entityId: phaseRunId,
          description: `Invalid runSequence: ${phaseRun.runSequence}`,
          fixApplied: false,
        });
      }
    }
  }
  
  // 4. Check all tasks
  const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
  const taskMap = new Map<string, Task>();
  
  for (const taskId of taskIds) {
    const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`);
    const task = await readJsonFile<Task>(paths, taskPath);
    
    if (task) {
      taskMap.set(taskId, task);
      
      if (task.deliveryId !== deliveryId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "error",
          entityType: "task",
          entityId: taskId,
          description: `Task belongs to different delivery: ${task.deliveryId}`,
          fixApplied: false,
        });
      }
      
      if (!task.phaseRunId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "warning",
          entityType: "task",
          entityId: taskId,
          description: "Task missing phaseRunId",
          fixApplied: false,
        });
      }
      
      // Check dependencies reference valid tasks
      for (const depId of task.dependencies) {
        if (!taskMap.has(depId)) {
          // Check if dependency is in different phase
          const depPath = resolve(paths.deliveries, deliveryId, "tasks", `${depId}.json`);
          const depTask = await readJsonFile<Task>(paths, depPath);
          if (!depTask) {
            issuesFound.push({
              type: "inconsistent_reference",
              severity: "error",
              entityType: "task",
              entityId: taskId,
              description: `Task depends on missing task: ${depId}`,
              fixApplied: false,
            });
          }
        }
      }
    }
  }
  
  // 5. Detect dependency cycles
  const cycles = detectDependencyCycles(Array.from(taskMap.values()));
  for (const cycle of cycles) {
    issuesFound.push({
      type: "cycle_detected",
      severity: "error",
      entityType: "task",
      entityId: cycle.join(" -> "),
      description: `Dependency cycle detected: ${cycle.join(" -> ")}`,
      fixApplied: false,
    });
  }
  
  // 6. Check agent runs
  const agentRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "agent-runs"));
  for (const agentRunId of agentRunIds) {
    const agentRunPath = resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`);
    const agentRun = await readJsonFile<AgentRun>(paths, agentRunPath);
    
    if (agentRun) {
      if (agentRun.deliveryId !== deliveryId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "error",
          entityType: "agent_run",
          entityId: agentRunId,
          description: `Agent run belongs to different delivery: ${agentRun.deliveryId}`,
          fixApplied: false,
        });
      }
      
      if (agentRun.taskId && !taskMap.has(agentRun.taskId)) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "warning",
          entityType: "agent_run",
          entityId: agentRunId,
          description: `Agent run references missing task: ${agentRun.taskId}`,
          fixApplied: false,
        });
      }
    }
  }
  
  // 7. Check reviews
  const reviewRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "reviews"));
  for (const reviewRunId of reviewRunIds) {
    const reviewRunPath = resolve(paths.deliveries, deliveryId, "reviews", `${reviewRunId}.json`);
    const reviewRun = await readJsonFile<ReviewRun>(paths, reviewRunPath);
    
    if (reviewRun) {
      if (reviewRun.deliveryId !== deliveryId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "error",
          entityType: "review",
          entityId: reviewRunId,
          description: `Review run belongs to different delivery: ${reviewRun.deliveryId}`,
          fixApplied: false,
        });
      }
      
      if (reviewRun.phaseRunId) {
        const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${reviewRun.phaseRunId}.json`);
        const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
        if (!phaseRun) {
          issuesFound.push({
            type: "inconsistent_reference",
            severity: "warning",
            entityType: "review",
            entityId: reviewRunId,
            description: `Review references missing phase run: ${reviewRun.phaseRunId}`,
            fixApplied: false,
          });
        }
      }
    }
  }
  
  // 8. Check findings
  const findingIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "findings"));
  for (const findingId of findingIds) {
    const findingPath = resolve(paths.deliveries, deliveryId, "findings", `${findingId}.json`);
    const finding = await readJsonFile<Finding>(paths, findingPath);
    
    if (finding) {
      if (finding.deliveryId !== deliveryId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "error",
          entityType: "finding",
          entityId: findingId,
          description: `Finding belongs to different delivery: ${finding.deliveryId}`,
          fixApplied: false,
        });
      }
      
      if (finding.reviewRunId) {
        const reviewRunPath = resolve(paths.deliveries, deliveryId, "reviews", `${finding.reviewRunId}.json`);
        const reviewRun = await readJsonFile<ReviewRun>(paths, reviewRunPath);
        if (!reviewRun) {
          issuesFound.push({
            type: "inconsistent_reference",
            severity: "warning",
            entityType: "finding",
            entityId: findingId,
            description: `Finding references missing review run: ${finding.reviewRunId}`,
            fixApplied: false,
          });
        }
      }
      
      if (finding.remediationTaskId && !taskMap.has(finding.remediationTaskId)) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "warning",
          entityType: "finding",
          entityId: findingId,
          description: `Finding references missing remediation task: ${finding.remediationTaskId}`,
          fixApplied: false,
        });
      }
    }
  }
  
  // 9. Check evidence
  const evidenceIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "evidence"));
  for (const evidenceId of evidenceIds) {
    const evidencePath = resolve(paths.deliveries, deliveryId, "evidence", `${evidenceId}.json`);
    const evidence = await readJsonFile<Evidence>(paths, evidencePath);
    
    if (evidence) {
      if (evidence.deliveryId !== deliveryId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "error",
          entityType: "evidence",
          entityId: evidenceId,
          description: `Evidence belongs to different delivery: ${evidence.deliveryId}`,
          fixApplied: false,
        });
      }
      
      if (evidence.taskId && !taskMap.has(evidence.taskId)) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "warning",
          entityType: "evidence",
          entityId: evidenceId,
          description: `Evidence references missing task: ${evidence.taskId}`,
          fixApplied: false,
        });
      }
    }
  }
  
  // 10. Check approvals
  const approvalIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "approvals"));
  for (const approvalId of approvalIds) {
    const approvalPath = resolve(paths.deliveries, deliveryId, "approvals", `${approvalId}.json`);
    const approval = await readJsonFile<Approval>(paths, approvalPath);
    
    if (approval) {
      if (approval.deliveryId !== deliveryId) {
        issuesFound.push({
          type: "inconsistent_reference",
          severity: "error",
          entityType: "approval",
          entityId: approvalId,
          description: `Approval belongs to different delivery: ${approval.deliveryId}`,
          fixApplied: false,
        });
      }
      
      if (approval.phaseRunId) {
        const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${approval.phaseRunId}.json`);
        const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
        if (!phaseRun) {
          issuesFound.push({
            type: "inconsistent_reference",
            severity: "warning",
            entityType: "approval",
            entityId: approvalId,
            description: `Approval references missing phase run: ${approval.phaseRunId}`,
            fixApplied: false,
          });
        }
      }
    }
  }
  
  return {
    deliveryId,
    checkedAt: new Date().toISOString(),
    issuesFound,
    issuesFixed,
    warnings,
  };
}

/**
 * Fix missing phase run reference in delivery
 */
async function fixMissingPhaseRun(paths: VstackPaths, deliveryId: string, delivery: Delivery): Promise<boolean> {
  const phaseRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "phases"));
  let latestCompleted: PhaseRun | null = null;
  
  for (const pid of phaseRunIds) {
    const pr = await readJsonFile<PhaseRun>(paths, resolve(paths.deliveries, deliveryId, "phases", `${pid}.json`));
    if (pr && pr.status === "completed" && (!latestCompleted || pr.runSequence > latestCompleted.runSequence)) {
      latestCompleted = pr;
    }
  }
  
  if (latestCompleted) {
    const updatedDelivery = { 
      ...delivery, 
      currentPhase: latestCompleted.phase,
      currentPhaseRunId: latestCompleted.id,
      status: "active" as DeliveryStatus 
    };
    await writeJsonFile(paths, resolve(paths.deliveries, deliveryId, "delivery.json"), updatedDelivery);
    return true;
  }
  
  return false;
}

/**
 * Detect dependency cycles in task graph
 */
function detectDependencyCycles(tasks: Task[]): TaskId[][] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set<TaskId>();
  const recStack = new Set<TaskId>();
  const cycles: TaskId[][] = [];
  
  function dfs(taskId: TaskId, path: TaskId[]): void {
    if (recStack.has(taskId)) {
      const cycleStart = path.indexOf(taskId);
      cycles.push(path.slice(cycleStart).concat(taskId));
      return;
    }
    
    if (visited.has(taskId)) return;
    
    visited.add(taskId);
    recStack.add(taskId);
    path.push(taskId);
    
    const task = taskMap.get(taskId);
    if (task?.dependencies) {
      for (const depId of task.dependencies) {
        dfs(depId, [...path]);
      }
    }
    
    recStack.delete(taskId);
    path.pop();
  }
  
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      dfs(task.id, []);
    }
  }
  
  return cycles;
}

/**
 * Quick health check for a delivery
 */
export async function healthCheck(paths: VstackPaths, deliveryId: string): Promise<{
  healthy: boolean;
  delivery: Delivery | null;
  phaseRun: PhaseRun | null;
  activeTask: Task | null;
  issues: string[];
}> {
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  
  if (!delivery) {
    return { healthy: false, delivery: null, phaseRun: null, activeTask: null, issues: ["Delivery not found"] };
  }
  
  const issues: string[] = [];
  let phaseRun: PhaseRun | null = null;
  let activeTask: Task | null = null;
  
  if (delivery.currentPhaseRunId) {
    const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`);
    phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
    
    if (!phaseRun) {
      issues.push("Current phase run missing");
    }
  }
  
  const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
  for (const taskId of taskIds) {
    const task = await readJsonFile<Task>(paths, resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`));
    if (task && (task.status === "in_progress" || task.status === "assigned")) {
      activeTask = task;
      break;
    }
  }
  
  return {
    healthy: issues.length === 0,
    delivery,
    phaseRun,
    activeTask,
    issues,
  };
}