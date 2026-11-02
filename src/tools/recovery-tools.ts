/**
 * vstack_recovery - Manage bounded recovery records for repeated failure handling
 */

import { VstackTool } from "./index.js";

export const recoveryTool: VstackTool = {
  name: "vstack_recovery",
  description: "Manage bounded recovery records: create, get, list, update, record-attempt, set-probe, set-approach, complete",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "record-attempt", "set-probe", "set-approach", "complete"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list)" },
      recoveryId: { type: "string", description: "Recovery ID (for get/update/record-attempt/set-probe/set-approach/complete)" },
      taskId: { type: "string", description: "Task ID (for create, optional)" },
      failureClass: { type: "string", description: "Failure class (for create)" },
      symptom: { type: "string", description: "Symptom description (for create)" },
      maxRecoveryRounds: { type: "number", description: "Max recovery rounds (for create)" },
      attempt: { 
        type: "object",
        properties: {
          description: { type: "string" },
          observedResult: { type: "string" },
          assumptionTested: { type: "string" },
        },
        required: ["description", "observedResult", "assumptionTested"],
        description: "Attempt details (for record-attempt)"
      },
      probe: { 
        type: "object",
        properties: {
          description: { type: "string" },
          command: { type: "array", items: { type: "string" } },
          result: { type: "string" },
        },
        required: ["description", "command", "result"],
        description: "Diagnostic probe (for set-probe)"
      },
      approach: { type: "string", description: "Changed approach description (for set-approach)" },
      outcome: { type: "string", enum: ["resolved", "escalated", "blocked"], description: "Final outcome (for complete)" },
      stopReason: { type: "string", description: "Stop reason (for complete)" },
      cleanupStatus: { type: "string", enum: ["pending", "completed", "failed"], description: "Cleanup status (for update)" },
      filters: { 
        type: "object", 
        properties: {
          finalOutcome: { type: "string" },
          taskId: { type: "string" },
        }
      },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { recoveryStore } = vstack;
    
    if (!recoveryStore) {
      return { content: JSON.stringify({ error: "Recovery store not initialized" }) };
    }
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.failureClass || !input.symptom || !input.maxRecoveryRounds) {
          return { content: JSON.stringify({ error: "deliveryId, failureClass, symptom, maxRecoveryRounds required" }) };
        }
        const recovery = await recoveryStore.createRecovery({
          deliveryId: input.deliveryId,
          taskId: input.taskId,
          failureClass: input.failureClass,
          symptom: input.symptom,
          maxRecoveryRounds: input.maxRecoveryRounds,
        });
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "get": {
        if (!input.recoveryId) return { content: JSON.stringify({ error: "recoveryId required" }) };
        const recovery = await recoveryStore.getRecovery(input.recoveryId);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const filters: any = {};
        if (input.filters?.finalOutcome) filters.finalOutcome = input.filters.finalOutcome;
        if (input.filters?.taskId) filters.taskId = input.filters.taskId;
        const recoveries = await recoveryStore.listRecoveries(input.deliveryId, filters);
        return { content: JSON.stringify({ recoveries }) };
      }
      
      case "update": {
        if (!input.recoveryId) return { content: JSON.stringify({ error: "recoveryId required" }) };
        const updates: any = {};
        if (input.cleanupStatus) updates.cleanupStatus = input.cleanupStatus;
        if (input.outcome) updates.finalOutcome = input.outcome;
        if (input.stopReason) updates.stopReason = input.stopReason;
        const recovery = await recoveryStore.updateRecovery(input.recoveryId, updates);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "record-attempt": {
        if (!input.recoveryId || !input.attempt) {
          return { content: JSON.stringify({ error: "recoveryId and attempt required" }) };
        }
        const recovery = await recoveryStore.recordAttempt(input.recoveryId, input.attempt);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "set-probe": {
        if (!input.recoveryId || !input.probe) {
          return { content: JSON.stringify({ error: "recoveryId and probe required" }) };
        }
        const recovery = await recoveryStore.setDiagnosticProbe(input.recoveryId, input.probe);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "set-approach": {
        if (!input.recoveryId || !input.approach) {
          return { content: JSON.stringify({ error: "recoveryId and approach required" }) };
        }
        const recovery = await recoveryStore.setChangedApproach(input.recoveryId, input.approach);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "complete": {
        if (!input.recoveryId || !input.outcome || !input.stopReason) {
          return { content: JSON.stringify({ error: "recoveryId, outcome, stopReason required" }) };
        }
        const recovery = await recoveryStore.completeRecovery(input.recoveryId, input.outcome as any, input.stopReason);
        return { content: JSON.stringify({ recovery }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const recoveryTools = [recoveryTool];