/**
 * vstack_evaluation - Run behavioural evaluation suite
 */

import { VstackTool } from "./index.js";
import type { EvaluationScenario, EvaluationContext, EvaluationResult } from "../evaluation/evaluation-suite.js";

export const evaluationTool: VstackTool = {
  name: "vstack_evaluation",
  description: "Run behavioural evaluation suite: run scenarios, save results, generate summary",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["run-suite", "run-scenario", "list-scenarios", "save-summary"],
        description: "Action to perform" 
      },
      scenarioId: { type: "string", description: "Scenario ID to run (for run-scenario)" },
      skillId: { type: "string", description: "Skill ID being evaluated" },
      projectRoot: { type: "string", description: "Project root directory" },
      outputDir: { type: "string", description: "Output directory for results" },
      modelVersion: { type: "string", description: "Model version being evaluated" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { vstackRoot } = vstack;
    
    const { 
      MINIMUM_SCENARIOS, 
      runEvaluationSuite, 
      runScenario, 
      saveEvaluationSummary,
    } = await import("../evaluation/evaluation-suite.js");
    
    const scenarios = MINIMUM_SCENARIOS;
    const projectRoot = input.projectRoot || process.cwd();
    
    const baseContext: EvaluationContext = {
      scenarioId: "",
      skillId: input.skillId || "unknown",
      projectRoot,
      vstackRoot,
      artifacts: {
        modelVersion: input.modelVersion || "unknown",
      },
      startTime: new Date().toISOString(),
    };
    
    switch (input.action) {
      case "list-scenarios": {
        const list = scenarios.map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          description: s.description,
          expectedDurationMinutes: s.expectedDurationMinutes,
        }));
        return { content: JSON.stringify({ scenarios: list }) };
      }
      
      case "run-scenario": {
        if (!input.scenarioId) {
          return { content: JSON.stringify({ error: "scenarioId required" }) };
        }
        const scenario = scenarios.find(s => s.id === input.scenarioId);
        if (!scenario) {
          return { content: JSON.stringify({ error: `Scenario not found: ${input.scenarioId}` }) };
        }
        const context: EvaluationContext = {
          ...baseContext,
          scenarioId: scenario.id,
        };
        const result = await runScenario(scenario, context);
        return { content: JSON.stringify({ result }) };
      }
      
      case "run-suite": {
        const context: EvaluationContext = {
          ...baseContext,
          scenarioId: "full-suite",
        };
        const summary = await runEvaluationSuite(scenarios, context);
        return { content: JSON.stringify({ summary }) };
      }
      
      case "save-summary": {
        if (!input.outputDir) {
          return { content: JSON.stringify({ error: "outputDir required" }) };
        }
        return { content: JSON.stringify({ error: "Use run-suite which includes save" }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

export const evaluationTools = [evaluationTool];