/**
 * vstack_lesson - Manage lesson lifecycle (Candidate → Assessed → Promoted → Verified → Closed/Superseded)
 */

import { VstackTool } from "./index.js";

export const lessonTool: VstackTool = {
  name: "vstack_lesson",
  description: "Manage lesson lifecycle: create, get, list, update, promote, verify, close",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "promote", "verify", "close"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID (required for create/list)" },
      lessonId: { type: "string", description: "Lesson ID (for get/update/promote/verify/close)" },
      taskId: { type: "string", description: "Task ID (for create)" },
      failureClass: { type: "string", description: "Failure class (for create)" },
      occurrences: { type: "array", items: { type: "string" }, description: "Occurrences (for create)" },
      recurrenceCount: { type: "number", description: "Recurrence count (for create)" },
      impactAssessment: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Impact assessment (for create)" },
      owner: { type: "string", description: "Owner (for create)" },
      status: { type: "string", enum: ["candidate", "assessed", "promoted", "verified", "closed", "superseded"], description: "Status (for update)" },
      preventionMechanism: { type: "string", enum: ["structure", "types", "lint", "ci", "test", "skill", "memory"], description: "Prevention mechanism (for promote)" },
      implementationArtifact: { type: "string", description: "Implementation artifact (for promote)" },
      validationResult: { type: "string", enum: ["passed", "failed"], description: "Validation result (for verify)" },
      reason: { type: "string", description: "Close reason (for close)" },
      filters: { 
        type: "object", 
        properties: {
          status: { type: "array", items: { type: "string" } },
          failureClass: { type: "string" },
          taskId: { type: "string" },
        }
      },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { lessonStore } = vstack;
    
    if (!lessonStore) {
      return { content: JSON.stringify({ error: "Lesson store not initialized" }) };
    }
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.failureClass || !input.occurrences || !input.recurrenceCount || !input.impactAssessment || !input.owner) {
          return { content: JSON.stringify({ error: "deliveryId, failureClass, occurrences, recurrenceCount, impactAssessment, owner required" }) };
        }
        const lesson = await lessonStore.createLesson({
          deliveryId: input.deliveryId,
          taskId: input.taskId,
          failureClass: input.failureClass,
          occurrences: input.occurrences,
          recurrenceCount: input.recurrenceCount,
          impactAssessment: input.impactAssessment as any,
          owner: input.owner,
        });
        return { content: JSON.stringify({ lesson }) };
      }
      
      case "get": {
        if (!input.lessonId) return { content: JSON.stringify({ error: "lessonId required" }) };
        const lesson = await lessonStore.getLesson(input.lessonId);
        return { content: JSON.stringify({ lesson }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const filters: any = {};
        if (input.filters?.status) filters.status = input.filters.status;
        if (input.filters?.failureClass) filters.failureClass = input.filters.failureClass;
        if (input.filters?.taskId) filters.taskId = input.filters.taskId;
        const lessons = await lessonStore.listLessons(input.deliveryId, filters);
        return { content: JSON.stringify({ lessons }) };
      }
      
      case "update": {
        if (!input.lessonId) return { content: JSON.stringify({ error: "lessonId required" }) };
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.preventionMechanism) updates.preventionMechanism = input.preventionMechanism;
        if (input.implementationArtifact) updates.implementationArtifact = input.implementationArtifact;
        if (input.validationResult) updates.validationResult = input.validationResult;
        if (input.impactAssessment) updates.impactAssessment = input.impactAssessment;
        const lesson = await lessonStore.updateLesson(input.lessonId, updates);
        return { content: JSON.stringify({ lesson }) };
      }
      
      case "promote": {
        if (!input.lessonId || !input.preventionMechanism || !input.implementationArtifact) {
          return { content: JSON.stringify({ error: "lessonId, preventionMechanism, implementationArtifact required" }) };
        }
        const lesson = await lessonStore.promoteLesson(input.lessonId, input.preventionMechanism as any, input.implementationArtifact);
        return { content: JSON.stringify({ lesson }) };
      }
      
      case "verify": {
        if (!input.lessonId || !input.validationResult) {
          return { content: JSON.stringify({ error: "lessonId and validationResult required" }) };
        }
        const lesson = await lessonStore.verifyLesson(input.lessonId, input.validationResult as any);
        return { content: JSON.stringify({ lesson }) };
      }
      
      case "close": {
        if (!input.lessonId || !input.reason) {
          return { content: JSON.stringify({ error: "lessonId and reason required" }) };
        }
        const lesson = await lessonStore.closeLesson(input.lessonId, input.reason);
        return { content: JSON.stringify({ lesson }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const lessonTools = [lessonTool];