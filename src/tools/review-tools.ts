/**
 * vstack_review - Manage review sessions and findings
 */

import { VstackTool } from "./index.js";

export const reviewTool: VstackTool = {
  name: "vstack_review",
  description: "Manage review sessions and findings: create, get, list, update, add finding, dispose finding",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "add-finding", "update-finding", "dispose-finding"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list)" },
      reviewSessionId: { type: "string", description: "Review session ID (for get/update/add-finding/update-finding/dispose-finding)" },
      taskId: { type: "string", description: "Task ID (for create, optional)" },
      phaseRunId: { type: "string", description: "Phase run ID (for create, optional)" },
      type: { type: "string", enum: ["code", "design", "security", "architecture", "release", "post_mortem", "other"], description: "Review type (for create)" },
      independence: { type: "string", enum: ["confirmed", "declared", "not_independent", "unknown"], description: "Independence state (for create)" },
      reviewerId: { type: "string", description: "Reviewer ID (for create)" },
      reviewerSessionId: { type: "string", description: "Reviewer session ID (for create, optional)" },
      baseCommit: { type: "string", description: "Base commit SHA (for create)" },
      diffRef: { type: "string", description: "Diff reference (for create, optional)" },
      evidenceConsidered: { type: "array", items: { type: "string" }, description: "Evidence IDs considered (for create)" },
      status: { type: "string", enum: ["in_progress", "completed", "timed_out", "unavailable", "cancelled"], description: "Status (for update)" },
      evidenceToAdd: { type: "array", items: { type: "string" }, description: "Evidence IDs to add (for update)" },
      findingId: { type: "string", description: "Finding ID (for update-finding/dispose-finding)" },
      finding: { 
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "informational"] },
          category: { type: "string", enum: ["security", "correctness", "performance", "maintainability", "style", "architecture", "testing", "documentation", "other"] },
          title: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["severity", "category", "title", "description", "location"],
        description: "Finding details (for add-finding)"
      },
      disposition: { type: "string", enum: ["open", "fixed", "dismissed", "deferred", "accepted_risk"], description: "Disposition (for dispose-finding)" },
      rationale: { type: "string", description: "Rationale for disposition (for dispose-finding)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { reviewStore } = vstack;
    
    if (!reviewStore) {
      return { content: JSON.stringify({ error: "Review store not initialized" }) };
    }
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.type || !input.independence || !input.reviewerId || !input.baseCommit) {
          return { content: JSON.stringify({ error: "deliveryId, type, independence, reviewerId, baseCommit required" }) };
        }
        const session = await reviewStore.createReviewSession({
          deliveryId: input.deliveryId,
          taskId: input.taskId,
          phaseRunId: input.phaseRunId,
          type: input.type as any,
          independence: input.independence as any,
          reviewerId: input.reviewerId,
          reviewerSessionId: input.reviewerSessionId,
          baseCommit: input.baseCommit,
          diffRef: input.diffRef,
          evidenceConsidered: input.evidenceConsidered,
        });
        return { content: JSON.stringify({ session }) };
      }
      
      case "get": {
        if (!input.reviewSessionId) return { content: JSON.stringify({ error: "reviewSessionId required" }) };
        const session = await reviewStore.getReviewSession(input.reviewSessionId);
        return { content: JSON.stringify({ session }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const filters: any = {};
        if (input.status) filters.status = [input.status];
        if (input.type) filters.type = [input.type];
        if (input.independence) filters.independence = [input.independence];
        if (input.reviewerId) filters.reviewerId = input.reviewerId;
        const sessions = await reviewStore.listReviewSessions(input.deliveryId, filters);
        return { content: JSON.stringify({ sessions }) };
      }
      
      case "update": {
        if (!input.reviewSessionId) return { content: JSON.stringify({ error: "reviewSessionId required" }) };
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.evidenceToAdd) updates.evidenceConsidered = input.evidenceToAdd;
        const session = await reviewStore.updateReviewSession(input.reviewSessionId, updates);
        return { content: JSON.stringify({ session }) };
      }
      
      case "add-finding": {
        if (!input.reviewSessionId || !input.finding) {
          return { content: JSON.stringify({ error: "reviewSessionId and finding required" }) };
        }
        const finding = await reviewStore.addFinding(input.reviewSessionId, input.finding);
        return { content: JSON.stringify({ finding }) };
      }
      
      case "update-finding": {
        if (!input.reviewSessionId || !input.findingId) {
          return { content: JSON.stringify({ error: "reviewSessionId and findingId required" }) };
        }
        const updates: any = {};
        if (input.finding) {
          if (input.finding.severity) updates.severity = input.finding.severity;
          if (input.finding.category) updates.category = input.finding.category;
          if (input.finding.title) updates.title = input.finding.title;
          if (input.finding.description) updates.description = input.finding.description;
          if (input.finding.location) updates.location = input.finding.location;
          if (input.finding.evidenceRefs) updates.evidenceRefs = input.finding.evidenceRefs;
        }
        const finding = await reviewStore.updateFinding(input.reviewSessionId, input.findingId, updates);
        return { content: JSON.stringify({ finding }) };
      }
      
      case "dispose-finding": {
        if (!input.reviewSessionId || !input.findingId || !input.disposition || !input.rationale) {
          return { content: JSON.stringify({ error: "reviewSessionId, findingId, disposition, rationale required" }) };
        }
        const finding = await reviewStore.disposeFinding(input.reviewSessionId, input.findingId, input.disposition as any, input.rationale);
        return { content: JSON.stringify({ finding }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const reviewTools = [reviewTool];