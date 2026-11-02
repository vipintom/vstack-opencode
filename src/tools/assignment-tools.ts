/**
 * vstack_assignment - Create, get, list, update assignments, check write scope conflicts, validate outcomes
 */

import { VstackTool } from "./index.js";
import { resolve } from "node:path";

export const assignmentTool: VstackTool = {
  name: "vstack_assignment",
  description: "Manage worker assignments: create, get, list, update, check write scope conflicts, validate outcomes",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "check-conflict", "validate-outcome", "get-by-task"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list)" },
      assignmentId: { type: "string", description: "Assignment ID (for get/update/validate-outcome)" },
      taskId: { type: "string", description: "Task ID (for create/get-by-task)" },
      agentId: { type: "string", description: "Agent ID (for create)" },
      sessionId: { type: "string", description: "Session ID (for create)" },
      role: { type: "string", enum: ["lead", "builder", "reviewer"], description: "Role (for create)" },
      contract: { 
        type: "object", 
        description: "Task contract with objective, scope, outOfScope, dependencies, baseCommit, writablePaths, acceptanceCriteria, verification, expectedOutput, reportingFormat, stopConditions, escalationConditions",
        properties: {
          objective: { type: "string" },
          scope: { type: "array", items: { type: "string" } },
          outOfScope: { type: "array", items: { type: "string" } },
          dependencies: { type: "array", items: { type: "string" } },
          baseCommit: { type: "string" },
          writablePaths: { type: "array", items: { type: "string" } },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          verification: { type: "array", items: { type: "string" } },
          expectedOutput: { type: "array", items: { type: "string" } },
          reportingFormat: { type: "string", enum: ["structured", "markdown", "json"] },
          stopConditions: { type: "array", items: { type: "string" } },
          escalationConditions: { type: "array", items: { type: "string" } },
        },
        required: ["objective", "scope", "outOfScope", "dependencies", "baseCommit", "writablePaths", "acceptanceCriteria", "verification", "expectedOutput", "reportingFormat", "stopConditions", "escalationConditions"]
      },
      baseState: { 
        type: "object", 
        properties: {
          commit: { type: "string" },
          worktreePath: { type: "string" },
          branch: { type: "string" },
        },
        required: ["commit", "branch"]
      },
      writableScope: { type: "array", items: { type: "string" }, description: "Writable file paths (for create/check-conflict)" },
      isolationMethod: { type: "string", enum: ["worktree", "branch", "directory", "sequential"], description: "Isolation method (for create)" },
      dispatchPrompt: { type: "string", description: "Dispatch prompt (for create)" },
      contextReferences: { type: "array", items: { type: "string" }, description: "Context references (for create)" },
      status: { type: "string", enum: ["dispatched", "running", "completed", "failed", "cancelled", "blocked"], description: "New status (for update)" },
      outcome: { type: "string", enum: ["PASS", "ISSUES", "BLOCKED"], description: "Outcome (for update/validate-outcome)" },
      completedAt: { type: "string", description: "Completion timestamp (for update)" },
      changedFiles: { type: "array", items: { type: "string" }, description: "Changed files (for update)" },
      artifactPaths: { type: "array", items: { type: "string" }, description: "Artifact paths (for update)" },
      checksRun: { type: "array", items: { type: "string" }, description: "Checks run (for update)" },
      evidenceIds: { type: "array", items: { type: "string" }, description: "Evidence IDs (for update)" },
      assumptions: { type: "array", items: { type: "string" }, description: "Assumptions (for update)" },
      blockers: { type: "array", items: { type: "string" }, description: "Blockers (for update)" },
      handoffSummary: { type: "string", description: "Handoff summary (for update)" },
      excludeAssignmentId: { type: "string", description: "Assignment ID to exclude from conflict check" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { assignmentStore } = vstack;
    
    if (!assignmentStore) {
      return { content: JSON.stringify({ error: "Assignment store not initialized" }) };
    }
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.taskId || !input.agentId || !input.sessionId || !input.role || !input.contract || !input.baseState || !input.writableScope || !input.isolationMethod || !input.dispatchPrompt) {
          return { content: JSON.stringify({ error: "deliveryId, taskId, agentId, sessionId, role, contract, baseState, writableScope, isolationMethod, dispatchPrompt required" }) };
        }
        const assignment = await assignmentStore.createAssignment({
          deliveryId: input.deliveryId,
          taskId: input.taskId,
          agentId: input.agentId,
          sessionId: input.sessionId,
          role: input.role as any,
          contract: input.contract as any,
          baseState: input.baseState as any,
          writableScope: input.writableScope,
          isolationMethod: input.isolationMethod as any,
          dispatchPrompt: input.dispatchPrompt,
          contextReferences: input.contextReferences || [],
        });
        return { content: JSON.stringify({ assignment }) };
      }
      
      case "get": {
        if (!input.assignmentId) return { content: JSON.stringify({ error: "assignmentId required" }) };
        const assignment = await assignmentStore.getAssignment(input.assignmentId);
        return { content: JSON.stringify({ assignment }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const filters: any = {};
        if (input.status) filters.status = [input.status];
        if (input.role) filters.role = input.role as any;
        if (input.taskId) filters.taskId = input.taskId;
        if (input.outcome) filters.outcome = input.outcome as any;
        const assignments = await assignmentStore.listAssignments(input.deliveryId, filters);
        return { content: JSON.stringify({ assignments }) };
      }
      
      case "update": {
        if (!input.assignmentId) return { content: JSON.stringify({ error: "assignmentId required" }) };
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.outcome) updates.outcome = input.outcome;
        if (input.completedAt) updates.completedAt = input.completedAt;
        if (input.changedFiles) updates.changedFiles = input.changedFiles;
        if (input.artifactPaths) updates.artifactPaths = input.artifactPaths;
        if (input.checksRun) updates.checksRun = input.checksRun;
        if (input.evidenceIds) updates.evidenceIds = input.evidenceIds;
        if (input.assumptions) updates.assumptions = input.assumptions;
        if (input.blockers) updates.blockers = input.blockers;
        if (input.handoffSummary) updates.handoffSummary = input.handoffSummary;
        const assignment = await assignmentStore.updateAssignment(input.assignmentId, updates);
        return { content: JSON.stringify({ assignment }) };
      }
      
      case "check-conflict": {
        if (!input.deliveryId || !input.writableScope) {
          return { content: JSON.stringify({ error: "deliveryId and writableScope required" }) };
        }
        const conflicts = await assignmentStore.checkWriteScopeConflict(input.deliveryId, input.writableScope, input.excludeAssignmentId);
        return { content: JSON.stringify({ conflicts }) };
      }
      
      case "validate-outcome": {
        if (!input.assignmentId || !input.outcome) {
          return { content: JSON.stringify({ error: "assignmentId and outcome required" }) };
        }
        const evidence = {
          changedFiles: input.changedFiles || [],
          artifactPaths: input.artifactPaths || [],
          checksRun: input.checksRun || [],
          evidenceIds: input.evidenceIds || [],
          blockers: input.blockers || [],
        };
        const valid = await assignmentStore.validateAssignmentOutcome(input.assignmentId, input.outcome as any, evidence);
        return { content: JSON.stringify({ valid }) };
      }
      
      case "get-by-task": {
        if (!input.taskId) return { content: JSON.stringify({ error: "taskId required" }) };
        const assignment = await assignmentStore.getAssignmentByTask(input.taskId);
        return { content: JSON.stringify({ assignment }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const assignmentTools = [assignmentTool];