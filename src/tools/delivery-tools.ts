/**
 * vstack_delivery - Create, get, list, update delivery metadata/status
 */

import { VstackTool } from "./index.js";

export const deliveryTool: VstackTool = {
  name: "vstack_delivery",
  description: "Manage deliveries: create, get, list, update",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "can-complete"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (for get/update)" },
      title: { type: "string", description: "Title (for create)" },
      objective: { type: "string", description: "Objective/description (for create)" },
      type: { type: "string", enum: ["feature", "bugfix", "refactor", "migration", "infrastructure", "documentation", "operations", "release", "other"], description: "Delivery type (for create)" },
      acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Acceptance criteria (for create)" },
      risk: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Risk level (for create)" },
      labels: { type: "array", items: { type: "string" }, description: "Labels (for create)" },
      createdBy: { type: "string", description: "Creator agent/session ID (for create)" },
      status: { type: "string", enum: ["active", "blocked", "completed", "cancelled"], description: "New status (for update)" },
      blockedReason: { type: "string", description: "Reason if blocking (for update)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { deliveryStore, enforcementService } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.title || !input.objective || !input.createdBy) {
          return { content: JSON.stringify({ error: "title, objective, createdBy required" }) };
        }
        const delivery = await deliveryStore.createDelivery({
          title: input.title,
          objective: input.objective,
          type: (input.type as any) || "feature",
          acceptanceCriteria: input.acceptanceCriteria || [],
          risk: (input.risk as any) || "medium",
          labels: input.labels || [],
          createdBy: input.createdBy,
        });
        return { content: JSON.stringify({ delivery }) };
      }
      
      case "get": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const delivery = await deliveryStore.getDelivery(input.deliveryId);
        return { content: JSON.stringify({ delivery }) };
      }
      
      case "list": {
        const deliveries = await deliveryStore.listDeliveries({
          status: input.status as any,
          type: input.type as any,
        });
        return { content: JSON.stringify({ deliveries }) };
      }
      
      case "update": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        
        // Enforcement: check if delivery can be completed
        if (input.status === "completed") {
          const enforcement = await enforcementService.canCompleteDelivery(input.deliveryId);
          if (!enforcement.allowed) {
            return { content: JSON.stringify({ 
              error: "Delivery cannot be completed", 
              reasons: enforcement.reasons 
            }) };
          }
        }
        
        // Enforcement: blocked status requires reason
        if (input.status === "blocked" && !input.blockedReason) {
          return { content: JSON.stringify({ error: "Blocked status requires a reason (blockedReason)" }) };
        }
        
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.blockedReason) updates.blockedReason = input.blockedReason;
        if (input.title) updates.title = input.title;
        const delivery = await deliveryStore.updateDelivery(input.deliveryId, updates);
        return { content: JSON.stringify({ delivery }) };
      }
      
      case "can-complete": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const enforcement = await enforcementService.canCompleteDelivery(input.deliveryId);
        return { content: JSON.stringify({ enforcement }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const deliveryTools = [deliveryTool];