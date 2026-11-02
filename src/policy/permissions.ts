/**
 * Permissions and policy management
 * Defines agent permissions, approval policies, and autonomy modes
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile } from "../persistence/file-store.js";
import { resolve } from "node:path";

export type AutonomyMode = "assisted" | "supervised" | "autonomous";

export type ApprovalType = 
  | "design_approval"
  | "release_approval"
  | "publish_approval"
  | "production_deployment_approval"
  | "destructive_migration_approval"
  | "rollback_approval"
  | "scope_change_approval"
  | "external_api_approval";

export type AgentRole = 
  | "vstack-lead"
  | "vstack-architect"
  | "vstack-developer"
  | "vstack-test-engineer"
  | "vstack-reviewer"
  | "vstack-operator"
  | "human";

export interface PermissionRule {
  action: string;
  resource: string;
  effect: "allow" | "deny";
  conditions?: Record<string, unknown>;
}

export interface AgentPermissions {
  role: AgentRole;
  permissions: PermissionRule[];
  autonomyMode: AutonomyMode;
  maxConcurrentTasks: number;
  allowedTools: string[];
  allowedSkills: string[];
}

export interface ApprovalPolicy {
  type: ApprovalType;
  required: boolean;
  approvers: string[]; // roles or user IDs
  timeout: number; // ms
  autoApproveIf: string[]; // conditions
  requiresEvidence: boolean;
}

export interface PolicyConfig {
  autonomyMode: AutonomyMode;
  agentPermissions: Record<AgentRole, AgentPermissions>;
  approvalPolicies: Record<ApprovalType, ApprovalPolicy>;
  protectedOperations: ProtectedOperation[];
  defaultTimeout: number;
}

export interface ProtectedOperation {
  id: string;
  name: string;
  description: string;
  approvalType: ApprovalType;
  requiresEvidence: boolean;
  allowedRoles: AgentRole[];
  cooldown?: number; // ms between executions
}

/**
 * Default policy configuration
 */
export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  autonomyMode: "supervised",
  
  agentPermissions: {
    "vstack-lead": {
      role: "vstack-lead",
      autonomyMode: "supervised",
      maxConcurrentTasks: 5,
      allowedTools: [
        "vstack_*",
        "workflow_*",
        "task_*",
        "agent_*",
        "read",
        "glob",
        "grep",
      ],
      allowedSkills: [
        "vstack-role-lead",
        "vstack-discovery",
        "vstack-architecture",
        "vstack-planning",
        "vstack-review",
        "vstack-documentation",
        "vstack-release",
      ],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "write", resource: "workflow", effect: "allow" },
        { action: "execute", resource: "workflow_tool", effect: "allow" },
        { action: "dispatch", resource: "vstack-*", effect: "allow" },
        { action: "approve", resource: "protected_operation", effect: "allow" },
      ],
    },
    
    "vstack-architect": {
      role: "vstack-architect",
      autonomyMode: "supervised",
      maxConcurrentTasks: 2,
      allowedTools: [
        "read",
        "glob",
        "grep",
        "workflow_record_finding",
        "workflow_record_history",
        "workflow_set_plan",
      ],
      allowedSkills: [
        "vstack-role-architect",
        "vstack-discovery",
        "vstack-architecture",
        "vstack-planning",
      ],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "write", resource: "design_docs", effect: "allow" },
        { action: "write", resource: "architecture_decisions", effect: "allow" },
        { action: "execute", resource: "workflow_tool", effect: "allow" },
      ],
    },
    
    "vstack-developer": {
      role: "vstack-developer",
      autonomyMode: "supervised",
      maxConcurrentTasks: 3,
      allowedTools: [
        "read",
        "glob",
        "grep",
        "edit",
        "shell",
        "workflow_update_todo",
        "workflow_record_finding",
        "workflow_record_history",
        "workflow_evidence_record",
        "workflow_check_run",
      ],
      allowedSkills: [
        "vstack-role-developer",
        "vstack-implementation",
        "vstack-debugging",
        "vstack-testing",
        "vstack-documentation",
      ],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "write", resource: "assigned_scope", effect: "allow" },
        { action: "shell", resource: "build_commands", effect: "allow" },
        { action: "shell", resource: "test_commands", effect: "allow" },
        { action: "execute", resource: "workflow_tool", effect: "allow" },
      ],
    },
    
    "vstack-test-engineer": {
      role: "vstack-test-engineer",
      autonomyMode: "supervised",
      maxConcurrentTasks: 2,
      allowedTools: [
        "read",
        "glob",
        "grep",
        "edit",
        "shell",
        "workflow_evidence_record",
        "workflow_check_run",
        "workflow_check_discover",
      ],
      allowedSkills: [
        "vstack-role-test-engineer",
        "vstack-testing",
        "vstack-debugging",
      ],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "write", resource: "test_files", effect: "allow" },
        { action: "shell", resource: "test_commands", effect: "allow" },
        { action: "execute", resource: "workflow_tool", effect: "allow" },
      ],
    },
    
    "vstack-reviewer": {
      role: "vstack-reviewer",
      autonomyMode: "assisted",
      maxConcurrentTasks: 1,
      allowedTools: [
        "read",
        "glob",
        "grep",
        "workflow_review_record",
        "workflow_finding_update",
        "workflow_review_start",
      ],
      allowedSkills: [
        "vstack-role-reviewer",
        "vstack-review",
      ],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "execute", resource: "workflow_review_tool", effect: "allow" },
        { action: "write", resource: "review_findings", effect: "allow" },
        { action: "deny", resource: "shell", effect: "deny" },
        { action: "deny", resource: "edit", effect: "deny" },
        { action: "deny", resource: "subagent", effect: "deny" },
      ],
    },
    
    "vstack-operator": {
      role: "vstack-operator",
      autonomyMode: "supervised",
      maxConcurrentTasks: 2,
      allowedTools: [
        "read",
        "glob",
        "grep",
        "edit",
        "shell",
        "workflow_release_prepare",
        "workflow_release_validate",
        "workflow_release_publish",
        "workflow_deploy",
        "workflow_smoke_test",
        "workflow_rollback",
        "workflow_post_release_record",
      ],
      allowedSkills: [
        "vstack-role-operator",
        "vstack-release",
        "vstack-operations",
        "vstack-documentation",
      ],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "write", resource: "release_docs", effect: "allow" },
        { action: "write", resource: "changelog", effect: "allow" },
        { action: "shell", resource: "deploy_commands", effect: "allow" },
        { action: "execute", resource: "workflow_release_tool", effect: "allow" },
        { action: "execute", resource: "workflow_deploy_tool", effect: "allow" },
      ],
    },

    "human": {
      role: "human",
      autonomyMode: "assisted",
      maxConcurrentTasks: 1,
      allowedTools: [
        "read",
        "glob",
        "grep",
        "edit",
        "shell",
        "workflow_*",
        "task_*",
        "agent_*",
        "review_*",
        "release_*",
      ],
      allowedSkills: [
        "vstack-role-lead",
        "vstack-discovery",
        "vstack-architecture",
        "vstack-planning",
        "vstack-implementation",
        "vstack-testing",
        "vstack-review",
        "vstack-documentation",
        "vstack-release",
        "vstack-operations",
      ],
      permissions: [
        { action: "read", resource: "*", effect: "allow" },
        { action: "write", resource: "*", effect: "allow" },
        { action: "shell", resource: "*", effect: "allow" },
        { action: "execute", resource: "*", effect: "allow" },
        { action: "approve", resource: "*", effect: "allow" },
        { action: "deploy", resource: "*", effect: "allow" },
      ],
    },
  },
  
  approvalPolicies: {
    "design_approval": {
      type: "design_approval",
      required: true,
      approvers: ["vstack-lead", "human"],
      timeout: 86400000, // 24 hours
      autoApproveIf: [],
      requiresEvidence: true,
    },
    
    "release_approval": {
      type: "release_approval",
      required: true,
      approvers: ["vstack-lead", "human"],
      timeout: 86400000,
      autoApproveIf: [],
      requiresEvidence: true,
    },
    
    "publish_approval": {
      type: "publish_approval",
      required: true,
      approvers: ["vstack-lead", "human"],
      timeout: 86400000,
      autoApproveIf: [],
      requiresEvidence: true,
    },
    
    "production_deployment_approval": {
      type: "production_deployment_approval",
      required: true,
      approvers: ["vstack-lead", "human"],
      timeout: 86400000,
      autoApproveIf: [],
      requiresEvidence: true,
    },
    
    "destructive_migration_approval": {
      type: "destructive_migration_approval",
      required: true,
      approvers: ["vstack-lead", "human", "vstack-operator"],
      timeout: 604800000, // 7 days
      autoApproveIf: [],
      requiresEvidence: true,
    },
    
    "rollback_approval": {
      type: "rollback_approval",
      required: true,
      approvers: ["vstack-lead", "human", "vstack-operator"],
      timeout: 3600000, // 1 hour
      autoApproveIf: ["auto_rollback_triggered"],
      requiresEvidence: true,
    },
    
    "scope_change_approval": {
      type: "scope_change_approval",
      required: true,
      approvers: ["vstack-lead", "human"],
      timeout: 86400000,
      autoApproveIf: [],
      requiresEvidence: true,
    },
    
    "external_api_approval": {
      type: "external_api_approval",
      required: true,
      approvers: ["vstack-lead", "human"],
      timeout: 86400000,
      autoApproveIf: [],
      requiresEvidence: true,
    },
  },
  
  protectedOperations: [
    {
      id: "publish_package",
      name: "Publish Package",
      description: "Publish package to registry (npm, PyPI, etc.)",
      approvalType: "publish_approval",
      requiresEvidence: true,
      allowedRoles: ["vstack-operator", "vstack-lead"],
    },
    {
      id: "deploy_production",
      name: "Production Deployment",
      description: "Deploy to production environment",
      approvalType: "production_deployment_approval",
      requiresEvidence: true,
      allowedRoles: ["vstack-operator", "vstack-lead"],
    },
    {
      id: "destructive_migration",
      name: "Destructive Database Migration",
      description: "Run irreversible database migration",
      approvalType: "destructive_migration_approval",
      requiresEvidence: true,
      allowedRoles: ["vstack-operator", "vstack-lead"],
    },
    {
      id: "rollback_production",
      name: "Production Rollback",
      description: "Rollback production deployment",
      approvalType: "rollback_approval",
      requiresEvidence: true,
      allowedRoles: ["vstack-operator", "vstack-lead"],
    },
    {
      id: "external_api_call",
      name: "External API Call",
      description: "Make call to external API with side effects",
      approvalType: "external_api_approval",
      requiresEvidence: false,
      allowedRoles: ["vstack-lead", "vstack-operator"],
    },
    {
      id: "scope_change",
      name: "Scope Change",
      description: "Change delivery scope or requirements",
      approvalType: "scope_change_approval",
      requiresEvidence: true,
      allowedRoles: ["vstack-lead", "human"],
    },
  ],
  
  defaultTimeout: 300000, // 5 minutes
};

/**
 * Create policy manager
 */
export async function createPolicyManager(paths: VstackPaths) {
  return {
    /**
     * Get agent permissions
     */
    getAgentPermissions(role: AgentRole): AgentPermissions | null {
      return DEFAULT_POLICY_CONFIG.agentPermissions[role] ?? null;
    },
    
    /**
     * Check if agent has permission
     */
    hasPermission(role: AgentRole, action: string, resource: string): boolean {
      const permissions = DEFAULT_POLICY_CONFIG.agentPermissions[role];
      if (!permissions) return false;
      
      // Check deny rules first
      for (const rule of permissions.permissions) {
        if (rule.effect === "deny" && 
            (rule.action === action || rule.action === "*") &&
            (rule.resource === resource || rule.resource === "*")) {
          return false;
        }
      }
      
      // Check allow rules
      for (const rule of permissions.permissions) {
        if (rule.effect === "allow" && 
            (rule.action === action || rule.action === "*") &&
            (rule.resource === resource || rule.resource === "*")) {
          return true;
        }
      }
      
      return false;
    },
    
    /**
     * Get approval policy
     */
    getApprovalPolicy(type: ApprovalType): ApprovalPolicy | null {
      return DEFAULT_POLICY_CONFIG.approvalPolicies[type] ?? null;
    },
    
    /**
     * Check if operation requires approval
     */
    requiresApproval(operationId: string): ProtectedOperation | null {
      return DEFAULT_POLICY_CONFIG.protectedOperations.find(op => op.id === operationId) ?? null;
    },
    
    /**
     * Get protected operations for role
     */
    getProtectedOperationsForRole(role: AgentRole): ProtectedOperation[] {
      return DEFAULT_POLICY_CONFIG.protectedOperations.filter(op => 
        op.allowedRoles.includes(role)
      );
    },
    
    /**
     * Check if autonomy mode allows action
     */
    canAutonomousAct(role: AgentRole, action: string): boolean {
      const permissions = DEFAULT_POLICY_CONFIG.agentPermissions[role];
      if (!permissions) return false;
      
      const mode = permissions.autonomyMode;
      
      if (mode === "autonomous") return true;
      if (mode === "assisted") return false;
      
      // Supervised: routine actions allowed, protected require approval
      const protectedOp = this.requiresApproval(action);
      if (protectedOp) return false;
      
      return this.hasPermission(role, "execute", action);
    },
    
    /**
     * Get all agent roles
     */
    getAllRoles(): AgentRole[] {
      return Object.keys(DEFAULT_POLICY_CONFIG.agentPermissions) as AgentRole[];
    },
    
    /**
     * Update agent permissions (requires admin)
     */
    async updateAgentPermissions(
      role: AgentRole,
      permissions: Partial<AgentPermissions>
    ): Promise<AgentPermissions | null> {
      // Would update config file
      return DEFAULT_POLICY_CONFIG.agentPermissions[role] ?? null;
    },
    
    /**
     * Update approval policy
     */
    async updateApprovalPolicy(
      type: ApprovalType,
      policy: Partial<ApprovalPolicy>
    ): Promise<ApprovalPolicy | null> {
      // Would update config file
      return DEFAULT_POLICY_CONFIG.approvalPolicies[type] ?? null;
    },
  };
}