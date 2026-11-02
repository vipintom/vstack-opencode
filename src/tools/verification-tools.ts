/**
 * vstack_verification - Manage project verification skill indexes
 */

import { VstackTool } from "./index.js";

export const verificationTool: VstackTool = {
  name: "vstack_verification",
  description: "Manage project verification skill indexes: create, get, list, update, validate freshness, get by path",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "validate", "by-path"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list)" },
      indexId: { type: "string", description: "Index ID (for get/update/validate)" },
      projectPath: { type: "string", description: "Project path (for create)" },
      harness: { type: "string", enum: ["opencode", "codex", "claude-code", "other"], description: "Harness (for create)" },
      skillPath: { type: "string", description: "Skill file path (for create/by-path)" },
      version: { type: "string", description: "Version (for create)" },
      surfaceCoverage: { type: "array", items: { type: "string" }, description: "Surface coverage (for create)" },
      gaps: { type: "array", items: { type: "string" }, description: "Gaps (for create)" },
      updates: { 
        type: "object", 
        properties: {
          contentHash: { type: "string" },
          version: { type: "string" },
          surfaceCoverage: { type: "array", items: { type: "string" } },
          lastValidated: { type: "string" },
          validationEvidence: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["current", "stale", "missing", "unknown"] },
          gaps: { type: "array", items: { type: "string" } },
        },
        description: "Updates for update action" 
      },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { verificationIndexStore } = vstack;
    
    if (!verificationIndexStore) {
      return { content: JSON.stringify({ error: "Verification index store not initialized" }) };
    }
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.projectPath || !input.harness || !input.skillPath || !input.version || !input.surfaceCoverage) {
          return { content: JSON.stringify({ error: "deliveryId, projectPath, harness, skillPath, version, surfaceCoverage required" }) };
        }
        const index = await verificationIndexStore.createIndex({
          deliveryId: input.deliveryId,
          projectPath: input.projectPath,
          harness: input.harness as any,
          skillPath: input.skillPath,
          version: input.version,
          surfaceCoverage: input.surfaceCoverage,
          gaps: input.gaps || [],
        });
        return { content: JSON.stringify({ index }) };
      }
      
      case "get": {
        if (!input.indexId) return { content: JSON.stringify({ error: "indexId required" }) };
        const index = await verificationIndexStore.getIndex(input.indexId);
        return { content: JSON.stringify({ index }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const indexes = await verificationIndexStore.listIndexes(input.deliveryId);
        return { content: JSON.stringify({ indexes }) };
      }
      
      case "update": {
        if (!input.indexId || !input.updates) {
          return { content: JSON.stringify({ error: "indexId and updates required" }) };
        }
        const index = await verificationIndexStore.updateIndex(input.indexId, input.updates as any);
        return { content: JSON.stringify({ index }) };
      }
      
      case "validate": {
        if (!input.indexId) return { content: JSON.stringify({ error: "indexId required" }) };
        const index = await verificationIndexStore.validateFreshness(input.indexId);
        return { content: JSON.stringify({ index }) };
      }
      
      case "by-path": {
        if (!input.skillPath) return { content: JSON.stringify({ error: "skillPath required" }) };
        const index = await verificationIndexStore.getIndexByPath(input.skillPath);
        return { content: JSON.stringify({ index }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const verificationTools = [verificationTool];