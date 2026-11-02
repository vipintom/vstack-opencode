/**
 * Autonomy policy management
 * Controls agent autonomy levels and behavioral constraints
 */

import { VstackPaths } from "../persistence/repository-root.js";

export type AutonomyMode = "assisted" | "supervised" | "autonomous";

export interface AutonomyConfig {
  defaultMode: AutonomyMode;
  modes: Record<AutonomyMode, AutonomyModeConfig>;
  transitions: AutonomyTransition[];
}

export interface AutonomyModeConfig {
  name: string;
  description: string;
  allowedActions: string[];
  requiresApproval: string[];
  maxConcurrentTasks: number;
  stepLimit: number;
  toolsAllowed: string[];
  skillsAllowed: string[];
  requiresHumanConfirmation: string[];
  forbiddenActions: string[];
}

export interface AutonomyTransition {
  from: AutonomyMode;
  to: AutonomyMode;
  requiresApproval: boolean;
  approvers: string[];
  conditions: string[];
}

export interface AutonomyPolicy {
  agentId: string;
  currentMode: AutonomyMode;
  overrides: Partial<AutonomyModeConfig>;
  lastTransition: string | null;
  transitionHistory: AutonomyTransitionRecord[];
}

export interface AutonomyTransitionRecord {
  from: AutonomyMode;
  to: AutonomyMode;
  timestamp: string;
  requestedBy: string;
  approvedBy: string | null;
  reason: string;
}

/**
 * Default autonomy configurations
 */
export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  defaultMode: "supervised",
  
  modes: {
    assisted: {
      name: "Assisted",
      description: "Agent proposes actions, waits for human confirmation",
      allowedActions: [
        "read", "glob", "grep", "search",
        "propose_plan", "propose_task", "propose_change",
        "ask_question", "request_review",
      ],
      requiresApproval: [
        "write", "edit", "shell", "subagent",
        "workflow_advance", "workflow_finish",
        "agent_dispatch", "release_publish",
        "deploy", "rollback",
      ],
      maxConcurrentTasks: 1,
      stepLimit: 10,
      toolsAllowed: ["read", "glob", "grep", "workflow_status", "workflow_record_finding"],
      skillsAllowed: ["vstack-*"],
      requiresHumanConfirmation: ["any_write", "any_execution", "any_delegation"],
      forbiddenActions: ["publish", "deploy_production", "destructive_migration", "rollback"],
    },
    
    supervised: {
      name: "Supervised",
      description: "Routine work proceeds; risky operations require approval",
      allowedActions: [
        "read", "glob", "grep", "search",
        "write", "edit", "shell",
        "workflow_start", "workflow_advance", "workflow_resume",
        "task_create", "task_update", "task_complete",
        "evidence_record", "check_run",
        "review_start", "finding_update",
        "subagent: vstack-architect,vstack-developer,vstack-test-engineer,vstack-operator",
        "propose_plan", "propose_task",
      ],
      requiresApproval: [
        "workflow_finish", "workflow_block",
        "release_publish", "deploy_production",
        "destructive_migration", "rollback_production",
        "subagent: vstack-reviewer",
        "scope_change",
      ],
      maxConcurrentTasks: 3,
      stepLimit: 30,
      toolsAllowed: [
        "read", "glob", "grep", "edit", "shell",
        "workflow_*", "task_*", "vstack_*", "vstack_release_*",
        "vstack_quality_*", "vstack_review_*",
      ],
      skillsAllowed: ["vstack-*"],
      requiresHumanConfirmation: [
        "release_publish", "deploy_production", "destructive_migration",
        "rollback", "scope_change", "workflow_finish",
      ],
      forbiddenActions: [],
    },
    
    autonomous: {
      name: "Autonomous",
      description: "Permitted low/medium risk operations without routine confirmation",
      allowedActions: [
        "read", "glob", "grep", "search",
        "write", "edit", "shell",
        "workflow_start", "workflow_advance", "workflow_resume", "workflow_finish",
        "task_create", "task_update", "task_complete", "task_assign",
        "evidence_record", "check_run", "check_discover",
        "review_start", "review_record", "finding_update",
        "subagent: vstack-*",
        "release_prepare", "release_validate",
      ],
      requiresApproval: [
        "release_publish", "deploy_production",
        "destructive_migration", "rollback_production",
        "external_api_call",
      ],
      maxConcurrentTasks: 5,
      stepLimit: 50,
      toolsAllowed: ["vstack_*", "workflow_*", "task_*", "agent_*", "read", "glob", "grep", "edit", "shell"],
      skillsAllowed: ["vstack-*"],
      requiresHumanConfirmation: [
        "release_publish", "deploy_production", "destructive_migration",
        "rollback_production", "external_api_call",
      ],
      forbiddenActions: [],
    },
  },
  
  transitions: [
    { from: "assisted", to: "supervised", requiresApproval: false, approvers: [], conditions: ["user_request"] },
    { from: "supervised", to: "autonomous", requiresApproval: true, approvers: ["human", "vstack-lead"], conditions: ["project_config_allows", "no_pending_approvals"] },
    { from: "autonomous", to: "supervised", requiresApproval: false, approvers: [], conditions: ["user_request", "error_threshold_exceeded", "policy_violation"] },
    { from: "supervised", to: "assisted", requiresApproval: false, approvers: [], conditions: ["user_request", "complexity_increase"] },
  ],
};

/**
 * Create autonomy manager
 */
export async function createAutonomyManager(paths: string) {
  return {
    getCurrentMode(agentId: string): "supervised" {
      // Would read from config
      return "supervised";
    },
    
    getModeConfig(mode: "assisted" | "supervised" | "autonomous") {
      return DEFAULT_AUTONOMY_CONFIG.modes[mode];
    },
    
    canPerformAction(agentId: string, action: string): boolean {
      const mode = this.getCurrentMode("");
      const config = this.getModeConfig(mode);
      
      // Check forbidden
      if (config.forbiddenActions.includes(action)) return false;
      
      // Check if explicitly allowed
      if (config.allowedActions.includes(action)) return true;
      
      // Check if requires approval
      if (config.requiresApproval.includes(action)) return false;
      
      // Check subagent pattern
      if (action.startsWith("subagent:")) {
        const subagent = action.split(":")[1];
        const allowedSubagents = config.allowedActions.filter(a => a.startsWith("subagent:")).map(a => a.split(":")[1]);
        if (allowedSubagents.includes(subagent)) return true;
        if (config.requiresApproval.includes(action)) return false;
      }
      
      // Check tool patterns
      if (action.startsWith("workflow_") || action.startsWith("task_") || action.startsWith("vstack_")) {
        if (DEFAULT_AUTONOMY_CONFIG.modes.supervised.toolsAllowed.includes("vstack_*")) return true;
      }
      
      return false;
    },
    
    getRequiredApprovals(agentId: string, action: string): string[] {
      const mode = this.getCurrentMode("");
      const config = this.getModeConfig(mode);
      
      if (config.requiresApproval.includes(action)) {
        return ["human", "vstack-lead"];
      }
      return [];
    },
    
    async requestModeTransition(
      from: "assisted" | "supervised" | "autonomous",
      to: "assisted" | "supervised" | "autonomous",
      requestedBy: string,
      reason: string
    ): Promise<boolean> {
      const transition = DEFAULT_AUTONOMY_CONFIG.transitions.find(t => t.from === from && t.to === to);
      if (!transition) return false;
      
      if (transition.requiresApproval) {
        // Would request approval
        return false; // Pending approval
      }
      
      // Would execute transition
      return true;
    },
    
    getTransitionHistory(agentId: string): any[] {
      return [];
    },
  };
}