/**
 * vstack_agent - Dispatch an agent, associate session with work, inspect status, record handoff
 */

import { VstackTool } from "./index.js";

export const agentTool: VstackTool = {
  name: "vstack_agent",
  description: "Manage agent runs: dispatch, get, list, update, handoff",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["dispatch", "get", "list", "update", "handoff"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for dispatch/list)" },
      agentRunId: { type: "string", description: "Agent run ID (for get/update/handoff)" },
      taskId: { type: "string", description: "Task ID (for dispatch)" },
      agentId: { type: "string", enum: ["vstack-lead", "vstack-builder", "vstack-reviewer"], description: "Agent to dispatch (for dispatch)" },
      sessionId: { type: "string", description: "OpenCode session ID (for dispatch)" },
      role: { type: "string", enum: ["lead", "builder", "reviewer"], description: "Role (for dispatch)" },
      objective: { type: "string", description: "Objective for the agent (for dispatch)" },
      contextReferences: { type: "array", items: { type: "string" }, description: "Context file references (for dispatch)" },
      worktreePath: { type: "string", description: "Worktree path (for dispatch)" },
      status: { type: "string", enum: ["dispatched", "running", "completed", "failed", "cancelled"], description: "New status (for update)" },
      resultSummary: { type: "string", description: "Result summary (for update)" },
      error: { type: "string", description: "Error if failed (for update)" },
      handoffSummary: { type: "string", description: "Handoff summary (for handoff)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { agentRunStore, agentDispatch, taskStore, deliveryStore } = vstack;
    
    switch (input.action) {
      case "dispatch": {
        if (!input.deliveryId || !input.agentId || !input.sessionId || !input.objective) {
          return { content: JSON.stringify({ error: "deliveryId, agentId, sessionId, objective required" }) };
        }
        
        // Get delivery and task if provided
        const delivery = await deliveryStore.getDelivery(input.deliveryId);
        if (!delivery) return { content: JSON.stringify({ error: "Delivery not found" }) };
        
        let task = null;
        if (input.taskId) {
          task = await taskStore.getTask(input.taskId);
        }
        
        // Use the agent dispatch to start the session
        const dispatchResult = await agentDispatch.dispatchAgent({
          delivery,
          task,
          agentId: input.agentId,
          worktreePath: input.worktreePath || null,
          customPrompt: input.objective,
          contextFiles: input.contextReferences || [],
        });
        
        return { content: JSON.stringify({ dispatchResult }) };
      }
      
      case "get": {
        if (!input.agentRunId) return { content: JSON.stringify({ error: "agentRunId required" }) };
        const run = await agentRunStore.getAgentRun(input.agentRunId);
        return { content: JSON.stringify({ agentRun: run }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const runs = await agentRunStore.listAgentRuns(input.deliveryId, {
          status: input.status as any,
          role: input.role as any,
          taskId: input.taskId,
        });
        return { content: JSON.stringify({ agentRuns: runs }) };
      }
      
      case "update": {
        if (!input.agentRunId) return { content: JSON.stringify({ error: "agentRunId required" }) };
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.resultSummary) updates.resultSummary = input.resultSummary;
        if (input.error) updates.error = input.error;
        if (input.handoffSummary) updates.handoffSummary = input.handoffSummary;
        const run = await agentRunStore.updateAgentRun(input.agentRunId, updates);
        return { content: JSON.stringify({ agentRun: run }) };
      }
      
      case "handoff": {
        if (!input.agentRunId || !input.handoffSummary) {
          return { content: JSON.stringify({ error: "agentRunId and handoffSummary required" }) };
        }
        const run = await agentRunStore.recordHandoff(input.agentRunId, input.handoffSummary);
        return { content: JSON.stringify({ agentRun: run }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const agentTools = [agentTool];