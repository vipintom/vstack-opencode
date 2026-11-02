/**
 * vstack_skill_validate - Validate playbook skills, workflows, roles, and portability
 */

import { VstackTool } from "./index.js";
import { resolve } from "node:path";

export const skillValidateTool: VstackTool = {
  name: "vstack_skill_validate",
  description: "Validate playbook skills, workflows, roles, references, links, and portability",
  input: {
    type: "object",
    properties: {
      playbookRoot: { type: "string", description: "Playbook root directory (default: playbook/)" },
      checkPortability: { type: "boolean", description: "Check for OpenCode-specific references (default: true)" },
      checkLinks: { type: "boolean", description: "Check links for potential issues (default: true)" },
      checkLoops: { type: "boolean", description: "Check loop skills for stop/escalation conditions (default: true)" },
      allowedHarnessReferences: { type: "array", items: { type: "string" }, description: "Allowed harness-specific references" },
    },
    required: [],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { vstackRoot } = vstack;
    
    const { validatePlaybook } = await import("../skills/skill-validator.js");
    const playbookRoot = input.playbookRoot || resolve(vstackRoot, "../../playbook");
    
    const result = await validatePlaybook({
      playbookRoot,
      checkPortability: input.checkPortability ?? true,
      checkLinks: input.checkLinks ?? true,
      checkLoops: input.checkLoops ?? true,
      allowedHarnessReferences: input.allowedHarnessReferences || ["opencode", "codex", "claude-code"],
    });
    
    return { content: JSON.stringify(result) };
  },
};

export const skillValidateTools = [skillValidateTool];