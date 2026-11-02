/**
 * vstack_session_pickup - Validate repository state against checkpoints for safe session resumption
 */

import { VstackTool } from "./index.js";

export const sessionPickupTool: VstackTool = {
  name: "vstack_session_pickup",
  description: "Validate repository state against checkpoints and runtime state for safe session resumption",
  input: {
    type: "object",
    properties: {
      deliveryId: { type: "string", description: "Delivery ID to resume" },
    },
    required: ["deliveryId"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { 
      checkpointStore, 
      taskStore, 
      deliveryStore, 
      agentRunStore, 
      evidenceStore, 
      historyService,
      vstackRoot 
    } = vstack;
    
    if (!checkpointStore || !taskStore || !deliveryStore || !agentRunStore || !evidenceStore || !historyService || !vstackRoot) {
      return { content: JSON.stringify({ error: "Required services not initialized" }) };
    }
    
    const { performSessionPickup } = await import("../util/session-pickup.js");
    const paths = vstackRoot;
    
    const result = await performSessionPickup(
      paths,
      input.deliveryId,
      checkpointStore,
      taskStore,
      deliveryStore,
      agentRunStore,
      evidenceStore,
      historyService
    );
    
    return { content: JSON.stringify(result) };
  },
};

export const sessionPickupTools = [sessionPickupTool];