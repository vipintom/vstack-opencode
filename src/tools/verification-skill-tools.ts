/**
 * vstack_verification_skill - Generate and validate project verification skills
 */

import { VstackTool } from "./index.js";

export const verificationSkillTool: VstackTool = {
  name: "vstack_verification_skill",
  description: "Generate and validate project verification skills: discover, generate, validate",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["discover", "generate", "validate"],
        description: "Action to perform" 
      },
      projectRoot: { type: "string", description: "Project root directory (for discover/generate)" },
      outputDir: { type: "string", description: "Output directory for generated skill (for generate)" },
      skillPath: { type: "string", description: "Path to skill file to validate (for validate)" },
      customConfig: { 
        type: "object", 
        description: "Custom configuration to override discovered values (for generate)",
        properties: {
          projectName: { type: "string" },
          projectType: { type: "string", enum: ["web", "api", "cli", "desktop", "mobile", "service", "library"] },
          primaryLanguage: { type: "string" },
          packageManager: { type: "string", enum: ["npm", "yarn", "pnpm", "pip", "cargo", "go", "maven", "gradle"] },
          testFramework: { type: "string" },
          requiredServices: { type: "array", items: { type: "string" } },
          envVars: { type: "string" },
          configFiles: { type: "string" },
          testFixtures: { type: "string" },
          surfaces: { 
            type: "array", 
            items: { 
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                url: { type: "string" },
                healthCheck: { type: "string" },
              }
            }
          },
          setupCommands: { type: "string" },
          runCommands: { type: "string" },
          healthCommands: { type: "string" },
          driveMethods: { type: "array", items: { type: "object" } },
          observeMethods: { type: "array", items: { type: "object" } },
          cleanupCommands: { type: "string" },
          gaps: { type: "array", items: { type: "object" } },
          representativeScenario: { type: "string" },
          validationEvidence: { type: "string" },
          leadReviewer: { type: "string" },
          validationDate: { type: "string" },
        }
      },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { discoverProject, generateVerificationSkill, validateVerificationSkill } = await import("../skills/verification-skill-generator.js");
    
    switch (input.action) {
      case "discover": {
        if (!input.projectRoot) {
          return { content: JSON.stringify({ error: "projectRoot required" }) };
        }
        const discovery = await discoverProject(input.projectRoot);
        return { content: JSON.stringify({ discovery }) };
      }
      
      case "generate": {
        if (!input.projectRoot || !input.outputDir) {
          return { content: JSON.stringify({ error: "projectRoot and outputDir required" }) };
        }
        const outputPath = await generateVerificationSkill(input.projectRoot, input.outputDir, input.customConfig);
        return { content: JSON.stringify({ outputPath }) };
      }
      
      case "validate": {
        if (!input.skillPath) {
          return { content: JSON.stringify({ error: "skillPath required" }) };
        }
        const result = await validateVerificationSkill(input.skillPath);
        return { content: JSON.stringify(result) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const verificationSkillTools = [verificationSkillTool];