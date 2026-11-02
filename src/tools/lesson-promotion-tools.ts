/**
 * vstack_lesson_promotion - Manage lesson promotion workflow
 */

import { VstackTool } from "./index.js";

export const lessonPromotionTool: VstackTool = {
  name: "vstack_lesson_promotion",
  description: "Manage lesson promotion workflow: validate, execute, auto-promote, recommend prevention",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["validate", "execute", "auto-promote", "recommend-mechanism", "record-occurrence"],
        description: "Action to perform" 
      },
      lessonId: { type: "string", description: "Lesson ID (for validate/execute)" },
      targetStatus: { type: "string", enum: ["candidate", "assessed", "promoted", "verified", "closed", "superseded"], description: "Target status (for execute)" },
      preventionMechanism: { type: "string", enum: ["structure", "types", "lint", "ci", "test", "skill", "memory"], description: "Prevention mechanism (for execute)" },
      implementationArtifact: { type: "string", description: "Implementation artifact (for execute)" },
      assessor: { type: "string", description: "Assessor (for execute/auto-promote)" },
      validationEvidence: { type: "array", items: { type: "string" }, description: "Validation evidence (for execute)" },
      failureClass: { type: "string", description: "Failure class (for recommend-mechanism/record-occurrence)" },
      recurrenceCount: { type: "number", description: "Recurrence count (for recommend-mechanism)" },
      impactAssessment: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Impact assessment (for recommend-mechanism)" },
      deliveryId: { type: "string", description: "Delivery ID (for record-occurrence/auto-promote)" },
      taskId: { type: "string", description: "Task ID (for record-occurrence)" },
      evidenceId: { type: "string", description: "Evidence ID (for record-occurrence)" },
      owner: { type: "string", description: "Owner (for record-occurrence)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { lessonStore } = vstack;
    
    if (!lessonStore) {
      return { content: JSON.stringify({ error: "Lesson store not initialized" }) };
    }
    
    const { 
      validatePromotion, 
      executePromotion, 
      getRecommendedPreventionMechanism,
      recordLessonOccurrence,
      autoPromoteLessons 
    } = await import("../skills/lesson-promotion.js");
    
    switch (input.action) {
      case "validate": {
        if (!input.lessonId || !input.targetStatus || !input.preventionMechanism || !input.implementationArtifact) {
          return { content: JSON.stringify({ error: "lessonId, targetStatus, preventionMechanism, implementationArtifact required" }) };
        }
        const lesson = await lessonStore.getLesson(input.lessonId);
        if (!lesson) {
          return { content: JSON.stringify({ error: "Lesson not found" }) };
        }
        const validation = await validatePromotion(
          null as any,
          lesson,
          input.targetStatus as any,
          input.preventionMechanism as any,
          input.implementationArtifact
        );
        return { content: JSON.stringify({ validation }) };
      }
      
      case "execute": {
        if (!input.lessonId || !input.targetStatus || !input.preventionMechanism || !input.implementationArtifact || !input.assessor) {
          return { content: JSON.stringify({ error: "lessonId, targetStatus, preventionMechanism, implementationArtifact, assessor required" }) };
        }
        const workflow = await executePromotion(
          lessonStore,
          input.lessonId,
          input.targetStatus as any,
          input.preventionMechanism as any,
          input.implementationArtifact,
          input.assessor,
          input.validationEvidence || []
        );
        return { content: JSON.stringify({ workflow }) };
      }
      
      case "auto-promote": {
        if (!input.deliveryId || !input.assessor) {
          return { content: JSON.stringify({ error: "deliveryId and assessor required" }) };
        }
        const results = await autoPromoteLessons(lessonStore, input.deliveryId, input.assessor);
        return { content: JSON.stringify({ results }) };
      }
      
      case "recommend-mechanism": {
        if (!input.failureClass || !input.recurrenceCount || !input.impactAssessment) {
          return { content: JSON.stringify({ error: "failureClass, recurrenceCount, impactAssessment required" }) };
        }
        const mechanism = await getRecommendedPreventionMechanism(
          input.failureClass,
          input.recurrenceCount,
          input.impactAssessment as any
        );
        return { content: JSON.stringify({ mechanism }) };
      }
      
      case "record-occurrence": {
        if (!input.failureClass || !input.deliveryId || !input.evidenceId || !input.owner) {
          return { content: JSON.stringify({ error: "failureClass, deliveryId, evidenceId, owner required" }) };
        }
        const lesson = await recordLessonOccurrence(
          lessonStore,
          input.failureClass,
          input.deliveryId,
          input.taskId,
          input.evidenceId,
          input.owner
        );
        return { content: JSON.stringify({ lesson }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const lessonPromotionTools = [lessonPromotionTool];