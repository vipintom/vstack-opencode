/**
 * vstack_task - Create, get, list, update tasks, add dependencies, identify ready tasks
 */

import { VstackTool } from "./index.js";
import { resolve } from "node:path";
import { listFiles, readJsonFile } from "../persistence/file-store.js";

export const taskTool: VstackTool = {
  name: "vstack_task",
  description: "Manage tasks: create, get, list, update, add/remove dependencies, get ready tasks",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "add-dependency", "remove-dependency", "ready", "dependencies", "dependents", "can-complete"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list/ready)" },
      taskId: { type: "string", description: "Task ID (for get/update/dependencies)" },
      title: { type: "string", description: "Title (for create)" },
      description: { type: "string", description: "Description (for create)" },
      type: { type: "string", enum: ["discovery", "design", "planning", "implementation", "testing", "review", "documentation", "release", "deployment", "operations", "other"], description: "Task type (for create)" },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Priority (for create)" },
      dependencies: { type: "array", items: { type: "string" }, description: "Dependency task IDs (for create/add-dependency)" },
      acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Acceptance criteria (for create)" },
      expectedOutputs: { type: "array", items: { type: "string" }, description: "Expected outputs (for create)" },
      requiredSkills: { type: "array", items: { type: "string" }, description: "Required skills (for create)" },
      workScope: { type: "string", description: "Work scope/files (for create)" },
      worktreePath: { type: "string", description: "Worktree path (for create)" },
      maxAttempts: { type: "number", description: "Max attempts (for create, default 3)" },
      assignedAgentId: { type: "string", description: "Assigned agent ID (for create/update)" },
      status: { type: "string", enum: ["pending", "ready", "assigned", "in_progress", "review", "completed", "blocked", "failed", "cancelled", "skipped", "needs_rework"], description: "New status (for update)" },
      resultSummary: { type: "string", description: "Result summary (for update)" },
      evidenceIds: { type: "array", items: { type: "string" }, description: "Evidence IDs (for update)" },
      dependsOnTaskId: { type: "string", description: "Dependency to add/remove (for add-dependency/remove-dependency)" },
      blockedReason: { type: "string", description: "Reason for blocking (for update when status=blocked)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { taskStore, deliveryStore, enforcementService, vstackRoot } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.title || !input.description) {
          return { content: JSON.stringify({ error: "deliveryId, title, description required" }) };
        }
        const task = await taskStore.createTask({
          deliveryId: input.deliveryId,
          title: input.title,
          description: input.description,
          type: (input.type as any) || "implementation",
          priority: (input.priority as any) || "medium",
          dependencies: input.dependencies || [],
          acceptanceCriteria: input.acceptanceCriteria || [],
          expectedOutputs: input.expectedOutputs || [],
          requiredSkills: input.requiredSkills || [],
          workScope: input.workScope || "",
          worktreePath: input.worktreePath || null,
          maxAttempts: input.maxAttempts || 3,
          assignedAgentId: input.assignedAgentId || null,
        });
        return { content: JSON.stringify({ task }) };
      }
      
      case "get": {
        if (!input.taskId) return { content: JSON.stringify({ error: "taskId required" }) };
        const task = await taskStore.getTask(input.taskId);
        return { content: JSON.stringify({ task }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const tasks = await taskStore.listTasks(input.deliveryId, {
          status: input.status as any,
          type: input.type as any,
          assignedAgentId: input.assignedAgentId,
        });
        return { content: JSON.stringify({ tasks }) };
      }
      
      case "update": {
        if (!input.taskId) return { content: JSON.stringify({ error: "taskId required" }) };
        
        // Enforcement: check if task can be completed
        if (input.status === "completed") {
          // Find delivery for task
          const deliveryDirs = listFiles(vstackRoot, resolve(vstackRoot.deliveries));
          let foundDeliveryId: string | null = null;
          
          for (const dir of deliveryDirs) {
            const t = await readJsonFile(vstack, resolve(vstackRoot.deliveries, dir, "tasks", `${input.taskId}.json`));
            if (t) {
              foundDeliveryId = dir;
              break;
            }
          }
          
          if (foundDeliveryId) {
            const enforcement = await enforcementService.canCompleteTask(foundDeliveryId, input.taskId);
            if (!enforcement.allowed) {
              return { content: JSON.stringify({ 
                error: "Task cannot be completed", 
                reasons: enforcement.reasons 
              }) };
            }
          }
        }
        
        // Enforcement: blocked status requires reason
        if (input.status === "blocked" && !input.blockedReason) {
          return { content: JSON.stringify({ error: "Blocked status requires a reason (blockedReason)" }) };
        }
        
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.resultSummary) updates.resultSummary = input.resultSummary;
        if (input.evidenceIds) updates.evidenceIds = input.evidenceIds;
        if (input.assignedAgentId) updates.assignedAgentId = input.assignedAgentId;
        if (input.title) updates.title = input.title;
        if (input.description) updates.description = input.description;
        if (input.blockedReason) updates.blocker = { type: "technical", message: input.blockedReason, details: {}, at: new Date().toISOString(), blockingTaskIds: [] };
        const task = await taskStore.updateTask(input.taskId, updates);
        return { content: JSON.stringify({ task }) };
      }
      
      case "add-dependency": {
        if (!input.taskId || !input.dependsOnTaskId) {
          return { content: JSON.stringify({ error: "taskId and dependsOnTaskId required" }) };
        }
        const task = await taskStore.addDependency(input.taskId, input.dependsOnTaskId);
        return { content: JSON.stringify({ task }) };
      }
      
      case "remove-dependency": {
        if (!input.taskId || !input.dependsOnTaskId) {
          return { content: JSON.stringify({ error: "taskId and dependsOnTaskId required" }) };
        }
        const task = await taskStore.removeDependency(input.taskId, input.dependsOnTaskId);
        return { content: JSON.stringify({ task }) };
      }
      
      case "ready": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const tasks = await taskStore.getReadyTasks(input.deliveryId);
        return { content: JSON.stringify({ tasks }) };
      }
      
      case "dependencies": {
        if (!input.taskId) return { content: JSON.stringify({ error: "taskId required" }) };
        const deps = await taskStore.getTaskDependencies(input.taskId);
        return { content: JSON.stringify({ dependencies: deps }) };
      }
      
      case "dependents": {
        if (!input.taskId) return { content: JSON.stringify({ error: "taskId required" }) };
        const task = await taskStore.getTask(input.taskId);
        if (!task) return { content: JSON.stringify({ error: "Task not found" }) };
        const deps = await taskStore.getTaskDependents(task.deliveryId, input.taskId);
        return { content: JSON.stringify({ dependents: deps }) };
      }
      
      case "can-complete": {
        if (!input.taskId) return { content: JSON.stringify({ error: "taskId required" }) };
        // Find delivery for task
        const deliveryDirs = listFiles(vstackRoot, resolve(vstackRoot.deliveries));
        let foundDeliveryId: string | null = null;
        
        for (const dir of deliveryDirs) {
          const t = await readJsonFile(vstack, resolve(vstackRoot.deliveries, dir, "tasks", `${input.taskId}.json`));
          if (t) {
            foundDeliveryId = dir;
            break;
          }
        }
        
        if (!foundDeliveryId) return { content: JSON.stringify({ error: "Task not found" }) };
        
        const enforcement = await enforcementService.canCompleteTask(foundDeliveryId, input.taskId);
        return { content: JSON.stringify({ enforcement }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const taskTools = [taskTool];