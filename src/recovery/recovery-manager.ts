/**
 * Recovery manager for vstack workflow state
 * Handles crash recovery, interrupted operations, and state reconciliation
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Delivery, Task, AgentRun, PhaseRun, ReviewRun, Finding, Evidence, Approval, Event, TaskStatus, PhaseRunStatus, DeliveryStatus } from "../schemas/types.js";
import { readJsonFile, listFiles, fileExists } from "../persistence/file-store.js";
import { readEvents, EventPayloads, appendEvent } from "../persistence/event-log.js";
import { writeJsonFile } from "../persistence/file-store.js";
import { resolve } from "node:path";

export interface RecoveryReport {
  deliveryId: string;
  recoveredAt: string;
  interruptedAgentRuns: AgentRun[];
  uncertainTasks: Task[];
  uncertainPhaseRuns: PhaseRun[];
  incompleteReviews: ReviewRun[];
  actionsTaken: RecoveryAction[];
  warnings: string[];
}

export interface RecoveryAction {
  type: "agent_run_marked_failed" | "task_reset_to_ready" | "phase_marked_blocked" | "review_marked_failed" | "event_logged";
  entityId: string;
  reason: string;
}

/**
 * Perform full recovery scan on startup
 */
export async function performRecovery(paths: VstackPaths): Promise<RecoveryReport[]> {
  const reports: RecoveryReport[] = [];
  
  // Find all deliveries
  const deliveryIds = listFiles(paths, paths.deliveries);
  
  for (const deliveryId of deliveryIds) {
    const report = await recoverDelivery(paths, deliveryId);
    if (report.actionsTaken.length > 0 || report.warnings.length > 0) {
      reports.push(report);
    }
  }
  
  return reports;
}

/**
 * Recover a single delivery
 */
async function recoverDelivery(paths: VstackPaths, deliveryId: string): Promise<RecoveryReport> {
  const actionsTaken: RecoveryAction[] = [];
  const warnings: string[] = [];
  
  // Read delivery
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  if (!delivery) {
    warnings.push(`Delivery ${deliveryId} not found`);
    return { deliveryId, recoveredAt: new Date().toISOString(), interruptedAgentRuns: [], uncertainTasks: [], uncertainPhaseRuns: [], incompleteReviews: [], actionsTaken, warnings };
  }
  
  // Only recover active/blocked deliveries
  if (delivery.status === "completed" || delivery.status === "cancelled" || delivery.status === "failed") {
    return { deliveryId, recoveredAt: new Date().toISOString(), interruptedAgentRuns: [], uncertainTasks: [], uncertainPhaseRuns: [], incompleteReviews: [], actionsTaken, warnings };
  }
  
  // Check agent runs
  const agentRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "agent-runs"));
  const interruptedAgentRuns: AgentRun[] = [];
  
  for (const agentRunId of agentRunIds) {
    const agentRunPath = resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`);
    const agentRun = await readJsonFile<AgentRun>(paths, agentRunPath);
    
    if (agentRun && (agentRun.status === "dispatched" || agentRun.status === "running")) {
      // Check if OpenCode session still exists
      const sessionExists = await checkSessionExists(agentRun.sessionId);
      
      if (!sessionExists) {
        interruptedAgentRuns.push(agentRun);
        
        // Check if there's evidence of completion
        const hasEvidence = agentRun.resultSummary && agentRun.resultSummary.length > 0;
        
        if (hasEvidence) {
          // Mark as completed with uncertainty
          const updatedRun = { ...agentRun, status: "completed" as const, completedAt: new Date().toISOString(), resultSummary: agentRun.resultSummary + " [RECOVERED: session lost, marked complete based on evidence]" };
          await writeJsonFile(paths, agentRunPath, updatedRun);
          actionsTaken.push({ type: "event_logged", entityId: agentRunId, reason: "Marked agent run completed based on evidence after session loss" });
        } else {
          // Mark as failed
          const updatedRun = { ...agentRun, status: "failed" as const, completedAt: new Date().toISOString(), error: "Session lost during recovery, no completion evidence" };
          await writeJsonFile(paths, agentRunPath, updatedRun);
          actionsTaken.push({ type: "agent_run_marked_failed", entityId: agentRunId, reason: "Session lost, no completion evidence" });
        }
        
        // Log recovery event
        await appendEvent(paths, EventPayloads.agentDispatched(deliveryId, agentRunId, agentRun.agentId, agentRun.taskId));
      }
    }
  }
  
  // Check tasks
  const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
  const uncertainTasks: Task[] = [];
  
  for (const taskId of taskIds) {
    const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`);
    const task = await readJsonFile<Task>(paths, taskPath);
    
    if (task && (task.status === "in_progress" || task.status === "assigned")) {
      uncertainTasks.push(task);
      
      // Check if agent run completed
      const agentRunPath = resolve(paths.deliveries, deliveryId, "agent-runs", `${task.assignedSessionId}.json`);
      const agentRun = await readJsonFile<AgentRun>(paths, agentRunPath);
      
      if (agentRun && agentRun.status === "completed") {
        // Agent completed but task not marked - reset to ready for verification
        const updatedTask = { ...task, status: "ready" as TaskStatus };
        await writeJsonFile(paths, taskPath, updatedTask);
        actionsTaken.push({ type: "task_reset_to_ready", entityId: taskId, reason: "Agent completed but task not updated, reset to ready" });
      } else if (agentRun && agentRun.status === "failed") {
        // Agent failed - mark task as failed
        const updatedTask = { ...task, status: "failed" as TaskStatus, blocker: { type: "technical" as const, message: "Agent run failed during recovery", details: { agentRunId: agentRun.id }, at: new Date().toISOString(), blockingTaskIds: [] } };
        await writeJsonFile(paths, taskPath, updatedTask);
        actionsTaken.push({ type: "task_reset_to_ready", entityId: taskId, reason: "Agent run failed, task marked failed" });
      } else {
        // Uncertain - reset to ready for re-execution
        const updatedTask = { ...task, status: "ready" as TaskStatus };
        await writeJsonFile(paths, taskPath, updatedTask);
        actionsTaken.push({ type: "task_reset_to_ready", entityId: taskId, reason: "Interrupted task reset to ready for re-execution" });
      }
    }
  }
  
  // Check phase runs
  const phaseRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "phases"));
  const uncertainPhaseRuns: PhaseRun[] = [];
  
  for (const phaseRunId of phaseRunIds) {
    const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
    const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
    
    if (phaseRun && (phaseRun.status === "active" || phaseRun.status === "verifying")) {
      uncertainPhaseRuns.push(phaseRun);
      
      // Check if all required gates have evidence
      const allGatesPassed = phaseRun.requiredGates.every(gateId => 
        phaseRun.gateResults.some(gr => gr.gateId === gateId && gr.status === "passed")
      );
      
      if (!allGatesPassed) {
        // Mark as blocked
        const updatedPhase = { 
          ...phaseRun, 
          status: "blocked" as PhaseRunStatus, 
          blockedAt: new Date().toISOString(),
          blockedReason: "Recovery: incomplete gate verification" 
        };
        await writeJsonFile(paths, phaseRunPath, updatedPhase);
        actionsTaken.push({ type: "phase_marked_blocked", entityId: phaseRunId, reason: "Incomplete gate verification after recovery" });
      } else {
        // All gates passed but phase not advanced - mark completed
        const updatedPhase = { 
          ...phaseRun, 
          status: "completed" as PhaseRunStatus, 
          completedAt: new Date().toISOString() 
        };
        await writeJsonFile(paths, phaseRunPath, updatedPhase);
        actionsTaken.push({ type: "event_logged", entityId: phaseRunId, reason: "Phase marked completed after recovery (all gates passed)" });
      }
    }
  }
  
  // Check reviews
  const reviewRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "reviews"));
  const incompleteReviews: ReviewRun[] = [];
  
  for (const reviewRunId of reviewRunIds) {
    const reviewRunPath = resolve(paths.deliveries, deliveryId, "reviews", `${reviewRunId}.json`);
    const reviewRun = await readJsonFile<ReviewRun>(paths, reviewRunPath);
    
    if (reviewRun && (reviewRun.status === "pending" || reviewRun.status === "running")) {
      incompleteReviews.push(reviewRun);
      
      // Check reviewer sessions
      let hasRunningReviewers = false;
      for (const reviewer of reviewRun.reviewers) {
        if (reviewer.sessionId) {
          const sessionExists = await checkSessionExists(reviewer.sessionId);
          if (sessionExists) {
            hasRunningReviewers = true;
          } else if (reviewer.status === "running") {
            // Reviewer session lost
            reviewer.status = "failed";
          }
        }
      }
      
      if (!hasRunningReviewers && reviewRun.status === "running") {
        // All reviewers lost - mark review as failed
        const updatedReview = { ...reviewRun, status: "failed" as const, completedAt: new Date().toISOString() };
        await writeJsonFile(paths, reviewRunPath, updatedReview);
        actionsTaken.push({ type: "review_marked_failed", entityId: reviewRunId, reason: "All reviewer sessions lost during recovery" });
      }
    }
  }
  
  return {
    deliveryId,
    recoveredAt: new Date().toISOString(),
    interruptedAgentRuns,
    uncertainTasks,
    uncertainPhaseRuns,
    incompleteReviews,
    actionsTaken,
    warnings,
  };
}

/**
 * Check if an OpenCode session still exists
 * This is a placeholder - actual implementation would use OpenCode API
 */
async function checkSessionExists(sessionId: string): Promise<boolean> {
  // In a real implementation, this would call OpenCode's session API
  // For now, return true to avoid false positives
  // The actual check should be done via ctx.session.get() in the plugin context
  return true;
}

/**
 * Reconcile state after recovery
 * Ensures consistency across all entities
 */
export async function reconcileState(paths: VstackPaths, deliveryId: string): Promise<void> {
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  if (!delivery) return;
  
  // Reconcile current phase/phase run
  if (delivery.currentPhaseRunId) {
    const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`);
    const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
    
    if (!phaseRun) {
      // Current phase run missing - find latest completed phase
      const phaseRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "phases"));
      let latestCompleted: PhaseRun | null = null;
      
      for (const pid of phaseRunIds) {
        const pr = await readJsonFile<PhaseRun>(paths, resolve(paths.deliveries, deliveryId, "phases", `${pid}.json`));
        if (pr && pr.status === "completed" && (!latestCompleted || pr.runSequence > latestCompleted.runSequence)) {
          latestCompleted = pr;
        }
      }
      
      if (latestCompleted) {
        // Update delivery to point to latest completed phase
        const updatedDelivery = { 
          ...delivery, 
          currentPhase: latestCompleted.phase,
          currentPhaseRunId: latestCompleted.id,
          status: "active" as DeliveryStatus 
        };
        await writeJsonFile(paths, deliveryPath, updatedDelivery);
      }
    }
  }
  
  // Reconcile active task
  if (delivery.status === "active" && delivery.currentPhaseRunId) {
    const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`);
    const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
    
    if (phaseRun) {
      // Find ready tasks in this phase
      const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
      let hasReadyTask = false;
      
      for (const taskId of taskIds) {
        const task = await readJsonFile<Task>(paths, resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`));
        if (task && task.phaseRunId === delivery.currentPhaseRunId && (task.status === "ready" || task.status === "pending")) {
          hasReadyTask = true;
          break;
        }
      }
      
      if (!hasReadyTask) {
        // Check if all tasks in phase are complete
        let allComplete = true;
        for (const taskId of taskIds) {
          const task = await readJsonFile<Task>(paths, resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`));
          if (task && task.phaseRunId === delivery.currentPhaseRunId && task.status !== "completed") {
            allComplete = false;
            break;
          }
        }
        
        if (allComplete) {
          // Phase complete - advance
          // This would be handled by workflow engine
        }
      }
    }
  }
}