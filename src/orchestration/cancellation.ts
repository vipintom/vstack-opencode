/**
 * Cancellation manager
 * Handles graceful cancellation of tasks, agent runs, and workflows
 */

import { 
  AgentRun, 
  AgentRunId, 
  TaskId, 
  Task, 
  TaskStatus, 
  Delivery,
  DeliveryId,
  deliveryId,
  agentRunId,
  taskId
} from "../schemas/types.js";
import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";

export interface CancellationConfig {
  gracefulTimeout: number; // ms to wait for graceful shutdown
  forceKillTimeout: number; // ms after which to force cancel
  cascadeToDependents: boolean; // cancel dependent tasks
  notifyOnCancel: boolean;
}

export interface CancellationResult {
  cancelled: string[]; // entity IDs that were cancelled
  failed: string[]; // entity IDs that failed to cancel
  reason: string;
}

export interface CancellationScope {
  type: "task" | "agent_run" | "phase" | "delivery";
  entityId: string;
  deliveryId: DeliveryId;
  reason: string;
  initiatedBy: "user" | "system" | "timeout" | "error" | "approval_rejected";
}

/**
 * Default cancellation configuration
 */
export const DEFAULT_CANCELLATION_CONFIG: CancellationConfig = {
  gracefulTimeout: 30000, // 30 seconds
  forceKillTimeout: 60000, // 1 minute
  cascadeToDependents: true,
  notifyOnCancel: true,
};

/**
 * Create cancellation manager
 */
export async function createCancellationManager(
  paths: VstackPaths,
  config: Partial<CancellationConfig> = {}
) {
  const fullConfig = { ...DEFAULT_CANCELLATION_CONFIG, ...config };
  
  return {
    /**
     * Cancel a task and optionally its dependents
     */
    async cancelTask(
      deliveryId: DeliveryId,
      taskId: TaskId,
      scope: CancellationScope
    ): Promise<CancellationResult> {
      const cancelled: string[] = [];
      const failed: string[] = [];
      
      // Get task
      const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`);
      const task = await readJsonFile<Task>(paths, taskPath);
      
      if (!task) {
        return { cancelled: [], failed: [taskId], reason: "Task not found" };
      }
      
      // Check if already completed/cancelled
      if (["completed", "cancelled", "failed"].includes(task.status)) {
        return { cancelled: [], failed: [taskId], reason: `Task already in terminal state: ${task.status}` };
      }
      
      // Cancel agent run if associated
      if (task.assignedSessionId) {
        const agentRunCancelled = await this.cancelAgentRunBySession(deliveryId, task.assignedSessionId, scope.reason);
        if (agentRunCancelled) {
          cancelled.push(`agent_run:${task.assignedSessionId}`);
        }
      }
      
      // Update task status
      const updatedTask = {
        ...task,
        status: "cancelled" as TaskStatus,
        blocker: {
          type: "external" as const,
          message: `Cancelled: ${scope.reason}`,
          details: { cancelledBy: scope.initiatedBy, cancelledAt: new Date().toISOString() },
          at: new Date().toISOString(),
          blockingTaskIds: [],
        },
        completedAt: new Date().toISOString(),
        revision: task.revision + 1,
      };
      
      await writeJsonFile(paths, taskPath, updatedTask);
      cancelled.push(taskId);
      
      // Cascade to dependents if configured
      if (fullConfig.cascadeToDependents) {
        const dependentTasks = await this.getDependentTasks(deliveryId, taskId);
        
        for (const depTaskId of dependentTasks) {
          const depResult = await this.cancelTask(deliveryId, depTaskId, {
            ...scope,
            entityId: depTaskId,
            reason: `Dependency cancelled: ${scope.reason}`,
          });
          
          cancelled.push(...depResult.cancelled);
          failed.push(...depResult.failed);
        }
      }
      
      // Log event
      await appendEvent(paths, {
        eventType: "task_cancelled",
        actor: { type: "system", id: scope.initiatedBy },
        entity: { type: "task", id: taskId },
        deliveryId,
        payload: { taskId, reason: scope.reason, cancelledBy: scope.initiatedBy },
        source: { sessionId: null, toolId: null },
        timestamp: new Date().toISOString(),
      });
      
      return { cancelled, failed, reason: scope.reason };
    },
    
    /**
     * Cancel an agent run by session ID
     */
    async cancelAgentRunBySession(
      deliveryId: DeliveryId,
      sessionId: string,
      reason: string
    ): Promise<boolean> {
      const agentRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "agent-runs"));
      
      for (const agentRunId of agentRunIds) {
        const agentRunPath = resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`);
        const agentRun = await readJsonFile<AgentRun>(paths, agentRunPath);
        
        if (agentRun && agentRun.sessionId === sessionId) {
          const updated = {
            ...agentRun,
            status: "cancelled" as const,
            completedAt: new Date().toISOString(),
            error: `Cancelled: ${reason}`,
            revision: agentRun.revision + 1,
          };
          
          await writeJsonFile(paths, agentRunPath, updated);
          return true;
        }
      }
      
      return false;
    },
    
    /**
     * Cancel an agent run by ID
     */
    async cancelAgentRun(
      deliveryId: DeliveryId,
      agentRunId: AgentRunId,
      scope: CancellationScope
    ): Promise<CancellationResult> {
      const agentRunPath = resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`);
      const agentRun = await readJsonFile<AgentRun>(paths, agentRunPath);
      
      if (!agentRun) {
        return { cancelled: [], failed: [agentRunId], reason: "Agent run not found" };
      }
      
      if (["completed", "failed", "cancelled"].includes(agentRun.status)) {
        return { cancelled: [], failed: [agentRunId], reason: `Agent run already terminal: ${agentRun.status}` };
      }
      
      const updated = {
        ...agentRun,
        status: "cancelled" as const,
        completedAt: new Date().toISOString(),
        error: `Cancelled: ${scope.reason}`,
        revision: agentRun.revision + 1,
      };
      
      await writeJsonFile(paths, agentRunPath, updated);
      
      // Update associated task
      if (agentRun.taskId) {
        const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${agentRun.taskId}.json`);
        const task = await readJsonFile<Task>(paths, taskPath);
        
        if (task && task.assignedSessionId === agentRun.sessionId) {
          const updatedTask = {
            ...task,
            status: "ready" as TaskStatus,
            assignedAgentId: null,
            assignedSessionId: null,
            blocker: {
              type: "external" as const,
              message: `Agent cancelled: ${scope.reason}`,
              details: { agentRunId, cancelledBy: scope.initiatedBy },
              at: new Date().toISOString(),
              blockingTaskIds: [],
            },
            revision: task.revision + 1,
          };
          
          await writeJsonFile(paths, taskPath, updatedTask);
        }
      }
      
      return { cancelled: [agentRunId], failed: [], reason: scope.reason };
    },
    
    /**
     * Cancel all tasks in a phase
     */
    async cancelPhase(
      deliveryId: DeliveryId,
      phaseRunId: string,
      scope: CancellationScope
    ): Promise<CancellationResult> {
      const cancelled: string[] = [];
      const failed: string[] = [];
      
      // Get all tasks in phase
      const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
      
      for (const taskId of taskIds) {
        const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`);
        const task = await readJsonFile<Task>(paths, taskPath);
        
        if (task && task.phaseRunId === phaseRunId) {
          const result = await this.cancelTask(deliveryId, taskId as TaskId, {
            ...scope,
            entityId: taskId,
            reason: `Phase cancelled: ${scope.reason}`,
          });
          
          cancelled.push(...result.cancelled);
          failed.push(...result.failed);
        }
      }
      
      // Cancel agent runs for this phase
      const agentRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "agent-runs"));
      
      for (const agentRunId of agentRunIds) {
        const agentRunPath = resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`);
        const agentRun = await readJsonFile<AgentRun>(paths, agentRunPath);
        
        if (agentRun && agentRun.taskId) {
          const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${agentRun.taskId}.json`);
          const task = await readJsonFile<Task>(paths, taskPath);
          
          if (task && task.phaseRunId === phaseRunId) {
            await this.cancelAgentRun(deliveryId, agentRunId as AgentRunId, {
              ...scope,
              entityId: agentRunId,
            });
            cancelled.push(agentRunId);
          }
        }
      }
      
      return { cancelled, failed, reason: scope.reason };
    },
    
    /**
     * Cancel entire delivery
     */
    async cancelDelivery(
      deliveryId: DeliveryId,
      scope: CancellationScope
    ): Promise<CancellationResult> {
      const cancelled: string[] = [];
      const failed: string[] = [];
      
      // Cancel all tasks
      const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
      
      for (const taskId of taskIds) {
        const result = await this.cancelTask(deliveryId, taskId as TaskId, {
          ...scope,
          entityId: taskId,
          reason: `Delivery cancelled: ${scope.reason}`,
        });
        
        cancelled.push(...result.cancelled);
        failed.push(...result.failed);
      }
      
      // Cancel all agent runs
      const agentRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "agent-runs"));
      
      for (const agentRunId of agentRunIds) {
        const result = await this.cancelAgentRun(deliveryId, agentRunId as AgentRunId, {
          ...scope,
          entityId: agentRunId,
        });
        
        cancelled.push(...result.cancelled);
        failed.push(...result.failed);
      }
      
      // Update delivery status
      const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
      const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
      
      if (delivery && delivery.status !== "completed") {
        const updatedDelivery = {
          ...delivery,
          status: "cancelled" as const,
          updatedAt: new Date().toISOString(),
          revision: delivery.revision + 1,
        };
        
        await writeJsonFile(paths, deliveryPath, updatedDelivery);
        cancelled.push(deliveryId);
      }
      
      return { cancelled, failed, reason: scope.reason };
    },
    
    /**
     * Get dependent tasks (tasks that depend on the given task)
     */
    async getDependentTasks(deliveryId: DeliveryId, taskId: TaskId): Promise<TaskId[]> {
      const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
      const dependents: TaskId[] = [];
      
      for (const id of taskIds) {
        const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${id}.json`);
        const task = await readJsonFile<Task>(paths, taskPath);
        
        if (task && task.dependencies.includes(taskId)) {
          dependents.push(task.id);
        }
      }
      
      return dependents;
    },
    
    /**
     * Graceful cancellation with timeout
     */
    async gracefulCancel(
      scope: CancellationScope,
      onProgress?: (cancelled: string, remaining: number) => void
    ): Promise<CancellationResult> {
      let result: CancellationResult = { cancelled: [], failed: [], reason: scope.reason };
      
      switch (scope.type) {
        case "task":
          result = await this.cancelTask(scope.deliveryId, scope.entityId as TaskId, scope);
          break;
        case "agent_run":
          result = await this.cancelAgentRun(scope.deliveryId, scope.entityId as AgentRunId, scope);
          break;
        case "phase":
          result = await this.cancelPhase(scope.deliveryId, scope.entityId, scope);
          break;
        case "delivery":
          result = await this.cancelDelivery(scope.deliveryId, scope);
          break;
      }
      
      // Wait for graceful shutdown
      await this.waitForGracefulShutdown(scope, fullConfig.gracefulTimeout);
      
      // Force cancel if still not done
      if (result.failed.length > 0) {
        const forceResult = await this.forceCancel(scope);
        result.cancelled.push(...forceResult.cancelled);
        result.failed = forceResult.failed;
      }
      
      return result;
    },
    
    /**
     * Force cancel (immediate)
     */
    async forceCancel(scope: CancellationScope): Promise<CancellationResult> {
      // Same as graceful but with forceKillTimeout
      return this.gracefulCancel({ ...scope, reason: `${scope.reason} (forced)` });
    },
    
    /**
     * Wait for graceful shutdown
     */
    async waitForGracefulShutdown(
      scope: CancellationScope,
      timeout: number
    ): Promise<void> {
      const startTime = Date.now();
      const checkInterval = 1000; // 1 second
      
      while (Date.now() - startTime < timeout) {
        // Check if all cancellations completed
        let allDone = true;
        
        // Implementation would check actual status
        // For now, just wait
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        
        // In real implementation, check if all entities are in cancelled state
        break;
      }
    },
  };
}

/**
 * List files helper (import from file-store)
 */
function listFiles(paths: VstackPaths, dirPath: string): string[] {
  const fs = require("node:fs");
  const { validateVstackPath } = require("../persistence/repository-root.js");
  
  const validatedPath = validateVstackPath(paths, dirPath);
  if (!fs.existsSync(validatedPath)) return [];
  
  try {
    return fs.readdirSync(validatedPath)
      .filter((name: string) => name.endsWith(".json"))
      .map((name: string) => name.slice(0, -5));
  } catch {
    return [];
  }
}