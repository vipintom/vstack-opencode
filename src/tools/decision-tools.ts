/**
 * vstack_decision - Create, get, list, update, supersede decision records
 */

import { VstackTool } from "./index.js";

export const decisionTool: VstackTool = {
  name: "vstack_decision",
  description: "Manage engineering decision records: create, get, list, update, supersede",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "supersede"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list)" },
      decisionId: { type: "string", description: "Decision ID (for get/update/supersede)" },
      taskId: { type: "string", description: "Task ID (for create)" },
      phase: { type: "string", description: "Phase (for create)" },
      summary: { type: "string", description: "Summary (for create)" },
      context: { type: "string", description: "Context (for create)" },
      alternatives: { type: "array", items: { type: "string" }, description: "Alternatives considered (for create)" },
      chosenOption: { type: "string", description: "Chosen option (for create)" },
      rationale: { type: "string", description: "Rationale (for create)" },
      evidenceReferences: { type: "array", items: { type: "string" }, description: "Evidence references (for create)" },
      createdBy: { type: "string", description: "Created by (for create)" },
      status: { type: "string", enum: ["active", "superseded", "reverted"], description: "Status (for update)" },
      newDecisionId: { type: "string", description: "New decision ID to supersede with (for supersede)" },
      filters: { 
        type: "object", 
        properties: {
          status: { type: "array", items: { type: "string" } },
          phase: { type: "string" },
          taskId: { type: "string" },
        }
      },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { decisionStore } = vstack;
    
    if (!decisionStore) {
      return { content: JSON.stringify({ error: "Decision store not initialized" }) };
    }
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.phase || !input.summary || !input.context || !input.alternatives || !input.chosenOption || !input.rationale || !input.evidenceReferences || !input.createdBy) {
          return { content: JSON.stringify({ error: "deliveryId, phase, summary, context, alternatives, chosenOption, rationale, evidenceReferences, createdBy required" }) };
        }
        const decision = await decisionStore.createDecision({
          deliveryId: input.deliveryId,
          taskId: input.taskId,
          phase: input.phase,
          summary: input.summary,
          context: input.context,
          alternatives: input.alternatives,
          chosenOption: input.chosenOption,
          rationale: input.rationale,
          evidenceReferences: input.evidenceReferences,
          createdBy: input.createdBy,
        });
        return { content: JSON.stringify({ decision }) };
      }
      
      case "get": {
        if (!input.decisionId) return { content: JSON.stringify({ error: "decisionId required" }) };
        const decision = await decisionStore.getDecision(input.decisionId);
        return { content: JSON.stringify({ decision }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const filters: any = {};
        if (input.filters?.status) filters.status = input.filters.status;
        if (input.filters?.phase) filters.phase = input.filters.phase;
        if (input.filters?.taskId) filters.taskId = input.filters.taskId;
        const decisions = await decisionStore.listDecisions(input.deliveryId, filters);
        return { content: JSON.stringify({ decisions }) };
      }
      
      case "update": {
        if (!input.decisionId) return { content: JSON.stringify({ error: "decisionId required" }) };
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.rationale) updates.rationale = input.rationale;
        if (input.evidenceReferences) updates.evidenceReferences = input.evidenceReferences;
        if (input.newDecisionId) updates.supersededBy = input.newDecisionId;
        const decision = await decisionStore.updateDecision(input.decisionId, updates);
        return { content: JSON.stringify({ decision }) };
      }
      
      case "supersede": {
        if (!input.decisionId || !input.newDecisionId) {
          return { content: JSON.stringify({ error: "decisionId and newDecisionId required" }) };
        }
        await decisionStore.supersedeDecision(input.decisionId, input.newDecisionId);
        return { content: JSON.stringify({ success: true }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const decisionTools = [decisionTool];