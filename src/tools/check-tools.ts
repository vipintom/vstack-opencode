/**
 * vstack_check - Discover supported checks, execute an explicitly selected check, record evidence, inspect completion requirements
 */

import { VstackTool } from "./index.js";

export const checkTool: VstackTool = {
  name: "vstack_check",
  description: "Execute checks and record evidence: discover, execute, list evidence, check completion",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["discover", "execute", "evidence", "completion"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for execute/evidence/completion)" },
      taskId: { type: "string", description: "Task ID (optional for execute)" },
      agentRunId: { type: "string", description: "Agent run ID (for execute)" },
      checkId: { type: "string", description: "Check ID to execute (for execute)" },
      command: { type: "array", items: { type: "string" }, description: "Command argv array (for execute)" },
      workingDirectory: { type: "string", description: "Working directory (for execute)" },
      commitRef: { type: "string", description: "Git commit SHA (for execute)" },
      timeoutMs: { type: "number", description: "Timeout in ms (for execute)" },
      sessionId: { type: "string", description: "Session ID (for execute)" },
      evidenceId: { type: "string", description: "Evidence ID (for evidence)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { checkService, deliveryStore, taskStore } = vstack;
    
    switch (input.action) {
      case "discover": {
        const checks = await checkService.discoverChecks(process.cwd());
        return { content: JSON.stringify({ checks }) };
      }
      
      case "execute": {
        if (!input.deliveryId || !input.checkId || !input.command || !input.commitRef) {
          return { content: JSON.stringify({ error: "deliveryId, checkId, command, commitRef required" }) };
        }
        const result = await checkService.executeCheck({
          deliveryId: input.deliveryId,
          taskId: input.taskId || null,
          agentRunId: input.agentRunId || null,
          checkId: input.checkId,
          command: input.command,
          workingDirectory: input.workingDirectory || process.cwd(),
          commitRef: input.commitRef,
          timeoutMs: input.timeoutMs,
          sessionId: input.sessionId || null,
        });
        return { content: JSON.stringify({ result }) };
      }
      
      case "evidence": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        if (input.evidenceId) {
          const evidence = await checkService.getEvidence(input.evidenceId);
          return { content: JSON.stringify({ evidence }) };
        }
        const evidence = await checkService.listEvidence(input.deliveryId, input.taskId);
        return { content: JSON.stringify({ evidence }) };
      }
      
      case "completion": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        
        // Check delivery status
        const delivery = await deliveryStore.getDelivery(input.deliveryId);
        if (!delivery) return { content: JSON.stringify({ error: "Delivery not found" }) };
        
        // Get all tasks
        const tasks = await taskStore.listTasks(input.deliveryId);
        const incompleteTasks = tasks.filter((t: any) => t.status !== "completed" && t.status !== "cancelled" && t.status !== "skipped");
        
        // Get evidence for incomplete tasks
        const evidence = await checkService.listEvidence(input.deliveryId);
        const failedEvidence = evidence.filter((e: any) => e.status === "failed");
        
        return { content: JSON.stringify({
          canComplete: incompleteTasks.length === 0 && failedEvidence.length === 0,
          incompleteTasks: incompleteTasks.map((t: any) => ({ id: t.id, title: t.title, status: t.status })),
          failedChecks: failedEvidence.map((e: any) => ({ checkId: e.checkId, status: e.status })),
        }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const checkTools = [checkTool];