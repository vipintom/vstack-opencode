/**
 * vstack_verification_maintain - Check and maintain verification skill freshness
 */

import { VstackTool } from "./index.js";

export const verificationMaintainTool: VstackTool = {
  name: "vstack_verification_maintain",
  description: "Check and maintain verification skill freshness: check freshness, detect triggers, run validation, update index",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["check-freshness", "detect-triggers", "run-validation", "run-smoke-test", "update-index"],
        description: "Action to perform" 
      },
      skillPath: { type: "string", description: "Path to verification skill file" },
      indexId: { type: "string", description: "Verification index ID (for update-index)" },
      procedures: { 
        type: "array", 
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            command: { type: "array", items: { type: "string" } },
            expectedOutput: { type: "string" },
            timeoutMs: { type: "number" },
          },
          required: ["name", "command"],
        },
        description: "Validation procedures to run" 
      },
      testCommand: { type: "array", items: { type: "string" }, description: "Test command for smoke test" },
      workingDirectory: { type: "string", description: "Working directory for smoke test" },
      validationResult: { 
        type: "object",
        properties: {
          passed: { type: "boolean" },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["passed", "evidence"],
        description: "Validation result for update-index" 
      },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { verificationIndexStore, vstackRoot } = vstack;
    
    if (!verificationIndexStore || !vstackRoot) {
      return { content: JSON.stringify({ error: "Required services not initialized" }) };
    }
    
    const { 
      checkVerificationSkillFreshness, 
      runValidationProcedure, 
      runSmokeTest,
      updateVerificationIndexAfterValidation 
    } = await import("../skills/verification-maintenance.js");
    
    const paths = vstackRoot;
    
    switch (input.action) {
      case "check-freshness": {
        if (!input.skillPath) {
          return { content: JSON.stringify({ error: "skillPath required" }) };
        }
        const result = await checkVerificationSkillFreshness(paths, input.skillPath, verificationIndexStore);
        return { content: JSON.stringify(result) };
      }
      
      case "run-validation": {
        if (!input.skillPath || !input.procedures) {
          return { content: JSON.stringify({ error: "skillPath and procedures required" }) };
        }
        const result = await runValidationProcedure(input.skillPath, input.procedures);
        return { content: JSON.stringify(result) };
      }
      
      case "run-smoke-test": {
        if (!input.skillPath || !input.testCommand || !input.workingDirectory) {
          return { content: JSON.stringify({ error: "skillPath, testCommand, workingDirectory required" }) };
        }
        const result = await runSmokeTest(input.skillPath, input.testCommand, input.workingDirectory);
        return { content: JSON.stringify(result) };
      }
      
      case "update-index": {
        if (!input.indexId || !input.validationResult) {
          return { content: JSON.stringify({ error: "indexId and validationResult required" }) };
        }
        const index = await updateVerificationIndexAfterValidation(verificationIndexStore, input.indexId, input.validationResult);
        return { content: JSON.stringify({ index }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const verificationMaintainTools = [verificationMaintainTool];