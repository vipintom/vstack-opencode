/**
 * vstack Tools - Main export
 * Registers ~7 cohesive tools under vstack_* namespace
 */

export interface VstackTool {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute: (input: any, context: any) => Promise<{ content: string }>;
}

import { statusTools } from "./status-tools.js";
import { memoryTools } from "./memory-tools.js";
import { historyTools } from "./history-tools.js";
import { deliveryTools } from "./delivery-tools.js";
import { taskTools } from "./task-tools.js";
import { agentTools } from "./agent-tools.js";
import { checkTools } from "./check-tools.js";
import { assignmentTools } from "./assignment-tools.js";
import { decisionTools } from "./decision-tools.js";
import { checkpointTools } from "./checkpoint-tools.js";
import { lessonTools } from "./lesson-tools.js";
import { recoveryTools } from "./recovery-tools.js";
import { verificationTools } from "./verification-tools.js";
import { sessionPickupTools } from "./session-pickup-tools.js";
import { verificationSkillTools } from "./verification-skill-tools.js";
import { skillValidateTools } from "./skill-validate-tools.js";
import { verificationMaintainTools } from "./verification-maintain-tools.js";
import { evaluationTools } from "./evaluation-tools.js";
import { lessonPromotionTools } from "./lesson-promotion-tools.js";
import { reviewTools } from "./review-tools.js";

export const vstackTools: VstackTool[] = [
  ...statusTools,
  ...memoryTools,
  ...historyTools,
  ...deliveryTools,
  ...taskTools,
  ...agentTools,
  ...checkTools,
  ...assignmentTools,
  ...decisionTools,
  ...checkpointTools,
  ...lessonTools,
  ...recoveryTools,
  ...verificationTools,
  ...sessionPickupTools,
  ...verificationSkillTools,
  ...skillValidateTools,
  ...verificationMaintainTools,
  ...evaluationTools,
  ...lessonPromotionTools,
  ...reviewTools,
];

export const toolsByNamespace = {
  status: statusTools,
  memory: memoryTools,
  history: historyTools,
  delivery: deliveryTools,
  task: taskTools,
  agent: agentTools,
  check: checkTools,
  assignment: assignmentTools,
  decision: decisionTools,
  checkpoint: checkpointTools,
  lesson: lessonTools,
  recovery: recoveryTools,
  verification: verificationTools,
  sessionPickup: sessionPickupTools,
  verificationSkill: verificationSkillTools,
  skillValidate: skillValidateTools,
  verificationMaintain: verificationMaintainTools,
  evaluation: evaluationTools,
  lessonPromotion: lessonPromotionTools,
  review: reviewTools,
};

export function getToolByName(name: string) {
  return vstackTools.find(t => t.name === name);
}

export const allToolNames = vstackTools.map(t => t.name);