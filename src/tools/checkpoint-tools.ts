/**
 * vstack_checkpoint - Create, get, list, update, revalidate checkpoints
 */

import { VstackTool } from "./index.js";

export const checkpointTool: VstackTool = {
  name: "vstack_checkpoint",
  description: "Manage progress checkpoints (PROGRESS.md integration): create, get, list, update, revalidate, latest",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "revalidate", "latest"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list/latest)" },
      checkpointId: { type: "string", description: "Checkpoint ID (for get/update/revalidate)" },
      taskId: { type: "string", description: "Task ID (for create)" },
      progressPath: { type: "string", description: "Path to PROGRESS.md (for create)" },
      branch: { type: "string", description: "Branch (for create)" },
      commit: { type: "string", description: "Commit SHA (for create)" },
      worktreePath: { type: "string", description: "Worktree path (for create)" },
      verifiedWork: { type: "array", items: { type: "string" }, description: "Verified work task IDs (for create)" },
      nextAction: { type: "string", description: "Next action (for create)" },
      openQuestions: { type: "array", items: { type: "string" }, description: "Open questions (for create)" },
      blockers: { type: "array", items: { type: "string" }, description: "Blockers (for create)" },
      keyFacts: { type: "object", description: "Key facts (for create)" },
      decisions: { type: "array", items: { type: "string" }, description: "Decision IDs (for create)" },
      failedApproaches: { type: "array", items: { type: "string" }, description: "Failed approaches (for create)" },
      verificationStatus: { 
        type: "object", 
        properties: {
          passed: { type: "array", items: { type: "string" } },
          failed: { type: "array", items: { type: "string" } },
          skipped: { type: "array", items: { type: "string" } },
          remaining: { type: "array", items: { type: "string" } },
        },
        description: "Verification status (for create)" 
      },
      updates: { type: "object", description: "Updates for update action" },
      repoState: { 
        type: "object", 
        properties: {
          branch: { type: "string" },
          commit: { type: "string" },
          worktreePath: { type: "string" },
          dirtyFiles: { type: "array", items: { type: "string" } },
        },
        required: ["branch", "commit"],
        description: "Current repo state for revalidation (for revalidate)" 
      },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { checkpointStore } = vstack;
    
    if (!checkpointStore) {
      return { content: JSON.stringify({ error: "Checkpoint store not initialized" }) };
    }
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.progressPath || !input.branch || !input.commit || !input.verifiedWork || !input.nextAction) {
          return { content: JSON.stringify({ error: "deliveryId, progressPath, branch, commit, verifiedWork, nextAction required" }) };
        }
        const checkpoint = await checkpointStore.createCheckpoint({
          deliveryId: input.deliveryId,
          taskId: input.taskId,
          progressPath: input.progressPath,
          branch: input.branch,
          commit: input.commit,
          worktreePath: input.worktreePath || null,
          verifiedWork: input.verifiedWork,
          nextAction: input.nextAction,
          openQuestions: input.openQuestions || [],
          blockers: input.blockers || [],
          keyFacts: input.keyFacts || {},
          decisions: input.decisions || [],
          failedApproaches: input.failedApproaches || [],
          verificationStatus: input.verificationStatus || { passed: [], failed: [], skipped: [], remaining: [] },
        });
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "get": {
        if (!input.checkpointId) return { content: JSON.stringify({ error: "checkpointId required" }) };
        const checkpoint = await checkpointStore.getCheckpoint(input.checkpointId);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const checkpoints = await checkpointStore.listCheckpoints(input.deliveryId);
        return { content: JSON.stringify({ checkpoints }) };
      }
      
      case "update": {
        if (!input.checkpointId || !input.updates) {
          return { content: JSON.stringify({ error: "checkpointId and updates required" }) };
        }
        const checkpoint = await checkpointStore.updateCheckpoint(input.checkpointId, input.updates);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "revalidate": {
        if (!input.checkpointId || !input.repoState) {
          return { content: JSON.stringify({ error: "checkpointId and repoState required" }) };
        }
        const checkpoint = await checkpointStore.revalidateCheckpoint(input.checkpointId, input.repoState);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "latest": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const checkpoint = await checkpointStore.getLatestCheckpoint(input.deliveryId);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const checkpointTools = [checkpointTool];