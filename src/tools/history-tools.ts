/**
 * vstack_history - Query recent activity or history for a delivery/task
 */

import { VstackTool } from "./index.js";

export const historyTool: VstackTool = {
  name: "vstack_history",
  description: "Query activity history: recent events, delivery history, task history, agent run history",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["recent", "delivery", "task", "agent", "stats"],
        description: "History query type" 
      },
      deliveryId: { type: "string", description: "Delivery ID (for delivery/task/agent)" },
      taskId: { type: "string", description: "Task ID (for task history)" },
      agentRunId: { type: "string", description: "Agent run ID (for agent history)" },
      limit: { type: "number", description: "Max results (default 50)" },
      eventTypes: { type: "array", items: { type: "string" }, description: "Filter by event types" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { historyService } = vstack;
    
    switch (input.action) {
      case "recent": {
        const events = await historyService.getRecentEvents({
          limit: input.limit || 50,
          eventTypes: input.eventTypes,
        });
        return { content: JSON.stringify({ events }) };
      }
      
      case "delivery": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const events = await historyService.getDeliveryHistory(input.deliveryId, {
          limit: input.limit || 100,
          eventTypes: input.eventTypes,
        });
        return { content: JSON.stringify({ events }) };
      }
      
      case "task": {
        if (!input.deliveryId || !input.taskId) return { content: JSON.stringify({ error: "deliveryId and taskId required" }) };
        const events = await historyService.getTaskHistory(input.deliveryId, input.taskId, {
          limit: input.limit || 50,
        });
        return { content: JSON.stringify({ events }) };
      }
      
      case "agent": {
        if (!input.agentRunId) return { content: JSON.stringify({ error: "agentRunId required" }) };
        const events = await historyService.getAgentRunHistory(input.agentRunId, {
          limit: input.limit || 50,
        });
        return { content: JSON.stringify({ events }) };
      }
      
      case "stats": {
        const stats = await historyService.getEventStats();
        return { content: JSON.stringify({ stats }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const historyTools = [historyTool];