/**
 * Enhanced Enforcement Service
 * 
 * Implements completion gates, required evidence checks, blocking finding dispositions,
 * action-scoped approvals, and permission validation.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Delivery, Task, Evidence, DeliveryStatus, TaskStatus, EvidenceProvenance, EvidenceOutcome } from "../schemas/types.js";
import { readJsonFile, listFiles } from "../persistence/file-store.js";
import { resolve } from "node:path";
import { ReviewSession, ReviewFinding, FindingDisposition } from "../schemas/types.js";
import { createHash } from "node:crypto";

export interface EnforcementService {
  canCompleteDelivery(deliveryId: string): Promise<EnforcementResult>;
  canCompleteTask(deliveryId: string, taskId: string): Promise<EnforcementResult>;
  validateBlockedStatus(deliveryId: string, entityType: "delivery" | "task", entityId: string, reason: string): Promise<EnforcementResult>;
  requiresApproval(action: ProtectedAction): boolean;
  recordApproval(action: ProtectedAction, deliveryId: string, granted: boolean, reason?: string): Promise<void>;
  checkCompletionGate(gate: CompletionGate, deliveryId: string, context: CompletionContext): Promise<EnforcementResult>;
  validateApprovalScope(approvalId: string, action: ProtectedAction, targetId: string): Promise<boolean>;
}

export interface EnforcementResult {
  allowed: boolean;
  reasons: string[];
  blockedBy?: string[];
}

export type ProtectedAction = 
  | "complete_delivery"
  | "complete_task"
  | "mark_delivery_blocked"
  | "mark_task_blocked"
  | "delete_delivery"
  | "delete_task"
  | "override_completion_gate"
  | "approve_release"
  | "approve_deployment"
  | "approve_destructive_migration"
  | "approve_rollback"
  | "approve_scope_change";

export type CompletionGateType = 
  | "required_evidence"
  | "blocking_findings"
  | "approval_required"
  | "all_tasks_complete"
  | "approvals_resolved"
  | "evidence_freshness";

export interface CompletionGate {
  type: CompletionGateType;
  name: string;
  description: string;
  severity: "error" | "warning";
  config: Record<string, unknown>;
}

export interface CompletionContext {
  taskId?: string;
  reviewSessionId?: string;
  approvalId?: string;
  requestedBy: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRecord {
  schemaVersion: 1;
  id: string;
  deliveryId: string;
  action: ProtectedAction;
  targetId: string;
  scope: string;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "granted" | "denied" | "expired";
  grantedBy?: string;
  grantedAt?: string;
  deniedBy?: string;
  deniedAt?: string;
  reason?: string;
  expiresAt?: string;
  scopeHash: string;
}

const PROTECTED_ACTIONS: ProtectedAction[] = [
  "complete_delivery",
  "complete_task",
  "mark_delivery_blocked",
  "mark_task_blocked",
  "delete_delivery",
  "delete_task",
  "override_completion_gate",
  "approve_release",
  "approve_deployment",
  "approve_destructive_migration",
  "approve_rollback",
  "approve_scope_change",
];

const DEFAULT_COMPLETION_GATES: CompletionGate[] = [
  {
    type: "all_tasks_complete",
    name: "All Tasks Complete",
    description: "All tasks in the delivery must be completed, cancelled, or skipped",
    severity: "error",
    config: {},
  },
  {
    type: "required_evidence",
    name: "Required Evidence Present",
    description: "Required evidence must exist and pass for task completion",
    severity: "error",
    config: { requireProvenance: ["plugin_observed"], minPassing: 1 },
  },
  {
    type: "blocking_findings",
    name: "Blocking Findings Resolved",
    description: "All blocking review findings must be resolved (fixed/dismissed/deferred/accepted_risk)",
    severity: "error",
    config: {},
  },
  {
    type: "evidence_freshness",
    name: "Evidence Freshness",
    description: "Evidence must be fresh (matches current commit)",
    severity: "warning",
    config: { maxAgeHours: 24 },
  },
];

function evidenceDir(paths: VstackPaths, deliveryId: string): string {
  return resolve(paths.deliveries, deliveryId, "evidence");
}

function approvalDir(paths: VstackPaths): string {
  return resolve(paths.deliveries, "..", "approvals");
}

function approvalFile(paths: VstackPaths, approvalId: string): string {
  return resolve(approvalDir(paths), `${approvalId}.json`);
}

function createScopeHash(action: string, targetId: string): string {
  return createHash("sha256").update(`${action}:${targetId}`).digest("hex");
}

async function getCompletionGatesImpl(paths: VstackPaths, deliveryId: string): Promise<CompletionGate[]> {
  return DEFAULT_COMPLETION_GATES;
}

async function getApprovalImpl(paths: VstackPaths, approvalId: string): Promise<any | null> {
  try {
    const approval = await readJsonFile<any>(paths, approvalFile(paths, approvalId));
    return approval || null;
  } catch {
    return null;
  }
}

async function listEvidenceForTask(paths: VstackPaths, deliveryId: string, taskId: string): Promise<any[]> {
  const dir = evidenceDir(paths, deliveryId);
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  
  if (!existsSync(dir)) return [];
  
  const files = readdirSync(dir).filter((f: string) => f.endsWith(".json"));
  const results: any[] = [];
  
  for (const file of files) {
    const evidence = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));
    if (evidence.taskId === taskId) {
      results.push(evidence);
    }
  }
  
  return results;
}

async function checkCompletionGateImpl(
  paths: VstackPaths,
  reviewStore: any,
  gate: CompletionGate,
  deliveryId: string,
  context: CompletionContext
): Promise<EnforcementResult> {
  switch (gate.type) {
    case "all_tasks_complete": {
      const taskDir = resolve(paths.deliveries, deliveryId, "tasks");
      const { readdirSync } = await import("node:fs");
      let taskFiles: string[] = [];
      try {
        taskFiles = readdirSync(taskDir).filter(f => f.endsWith(".json"));
      } catch {
        taskFiles = [];
      }
      
      const incompleteTasks: string[] = [];
      for (const file of taskFiles) {
        const taskPath = resolve(taskDir, file);
        const task = await readJsonFile<any>(paths, taskPath);
        if (task && task.status !== "completed" && task.status !== "cancelled" && task.status !== "skipped") {
          incompleteTasks.push(`${task.id}: ${task.title} (${task.status})`);
        }
      }
      
      if (incompleteTasks.length > 0) {
        return { allowed: false, reasons: [`${incompleteTasks.length} incomplete task(s): ${incompleteTasks.join("; ")}`], blockedBy: incompleteTasks };
      }
      return { allowed: true, reasons: [] };
    }
    
    case "required_evidence": {
      if (!context.taskId) {
        return { allowed: true, reasons: [] };
      }
      
      const config = gate.config as { requireProvenance?: EvidenceProvenance[]; minPassing?: number };
      const requireProvenance = config.requireProvenance || ["plugin_observed"];
      const minPassing = config.minPassing || 1;
      
      const evidence = await listEvidenceForTask(paths, deliveryId, context.taskId!);
      const validEvidence = evidence.filter(e => 
        e.status === "passed" && 
        requireProvenance.includes(e.provenance)
      );
      
      if (validEvidence.length < minPassing) {
        return { 
          allowed: false, 
          reasons: [`Task requires ${minPassing} passing evidence with provenance ${requireProvenance.join(", ")}, found ${validEvidence.length}`],
          blockedBy: ["insufficient_evidence"]
        };
      }
      return { allowed: true, reasons: [] };
    }
    
    case "blocking_findings": {
      if (!context.reviewSessionId) {
        const reviewSessions = await reviewStore.listReviewSessions(deliveryId);
        const blockingFindings: string[] = [];
        
        for (const session of reviewSessions) {
          for (const finding of session.findings) {
            if (finding.disposition === "open" && (finding.severity === "critical" || finding.severity === "high")) {
              blockingFindings.push(`${finding.id}: ${finding.title} (${finding.severity})`);
            }
          }
        }
        
        if (blockingFindings.length > 0) {
          return { 
            allowed: false, 
            reasons: [`${blockingFindings.length} blocking finding(s): ${blockingFindings.join("; ")}`],
            blockedBy: blockingFindings
          };
        }
        return { allowed: true, reasons: [] };
      }
      return { allowed: true, reasons: [] };
    }
    
    case "approval_required": {
      if (!context.approvalId) {
        return { allowed: true, reasons: [] };
      }
      
      const approval = await getApprovalImpl(paths, context.approvalId);
      if (!approval) {
        return { allowed: false, reasons: ["Approval record not found"], blockedBy: ["approval_not_found"] };
      }
      
      if (approval.status !== "granted") {
        return { allowed: false, reasons: [`Approval ${approval.id} is ${approval.status}`], blockedBy: ["approval_not_granted"] };
      }
      
      if (approval.expiresAt && new Date(approval.expiresAt) < new Date()) {
        return { allowed: false, reasons: ["Approval has expired"], blockedBy: ["approval_expired"] };
      }
      
      const expectedScopeHash = createScopeHash(approval.action, approval.targetId);
      if (approval.scopeHash !== expectedScopeHash) {
        return { allowed: false, reasons: ["Approval scope mismatch - cannot reuse for different action/target"], blockedBy: ["scope_mismatch"] };
      }
      
      return { allowed: true, reasons: [] };
    }
    
    case "evidence_freshness": {
      if (!context.taskId) return { allowed: true, reasons: [] };
      
      const config = gate.config as { maxAgeHours?: number };
      const maxAgeHours = config.maxAgeHours || 24;
      const evidence = await listEvidenceForTask(paths, deliveryId, context.taskId!);
      const staleEvidence: string[] = [];
      
      for (const ev of evidence) {
        if (ev.status === "passed") {
          const completedAt = new Date(ev.completedAt);
          const hoursSince = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60);
          if (hoursSince > maxAgeHours) {
            staleEvidence.push(`${ev.id} (${Math.round(hoursSince)}h old)`);
          }
        }
      }
      
      if (staleEvidence.length > 0) {
        return { 
          allowed: gate.severity === "warning", 
          reasons: [`${staleEvidence.length} stale evidence record(s): ${staleEvidence.join("; ")}`],
          blockedBy: staleEvidence.length > 0 ? ["stale_evidence"] : undefined
        };
      }
      return { allowed: true, reasons: [] };
    }
    
    default:
      return { allowed: true, reasons: [] };
  }
}

export async function createEnforcementService(paths: VstackPaths): Promise<EnforcementService> {
  const { createReviewStore } = await import("../quality/review-store.js");
  const reviewStore = await createReviewStore(paths);
  
  return {
    async canCompleteDelivery(deliveryId: string) {
      const reasons: string[] = [];
      const blockedBy: string[] = [];
      
      const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
      const delivery = await readJsonFile<any>(paths, deliveryPath);
      if (!delivery) {
        return { allowed: false, reasons: ["Delivery not found"], blockedBy: ["delivery_not_found"] };
      }
      
      const gates = await getCompletionGatesImpl(paths, deliveryId);
      for (const gate of gates) {
        const result = await checkCompletionGateImpl(paths, reviewStore, gate, deliveryId, { requestedBy: "system" });
        if (!result.allowed && gate.severity === "error") {
          reasons.push(...result.reasons);
          if (result.blockedBy) blockedBy.push(...result.blockedBy);
        }
      }
      
      return {
        allowed: reasons.length === 0,
        reasons,
        blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      };
    },
    
    async canCompleteTask(deliveryId: string, taskId: string) {
      const reasons: string[] = [];
      const blockedBy: string[] = [];
      
      const taskPath = resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`);
      const task = await readJsonFile<any>(paths, taskPath);
      if (!task) {
        return { allowed: false, reasons: ["Task not found"], blockedBy: ["task_not_found"] };
      }
      
      const gates = await getCompletionGatesImpl(paths, deliveryId);
      for (const gate of gates) {
        const result = await checkCompletionGateImpl(paths, reviewStore, gate, deliveryId, { taskId, requestedBy: "system" });
        if (!result.allowed && gate.severity === "error") {
          reasons.push(...result.reasons);
          if (result.blockedBy) blockedBy.push(...result.blockedBy);
        }
      }
      
      const incompleteDeps: string[] = [];
      for (const depId of task.dependencies) {
        const depPath = resolve(paths.deliveries, deliveryId, "tasks", `${depId}.json`);
        const depTask = await readJsonFile<any>(paths, depPath);
        if (!depTask || depTask.status !== "completed") {
          incompleteDeps.push(depId);
        }
      }
      
      if (incompleteDeps.length > 0) {
        reasons.push(`${incompleteDeps.length} incomplete dependency task(s): ${incompleteDeps.join(", ")}`);
      }
      
      if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
        const evidence = await listEvidenceForTask(paths, deliveryId, taskId);
        const passedChecks = evidence.filter((e: any) => e.status === "passed" && e.provenance === "plugin_observed");
        
        if (passedChecks.length === 0) {
          reasons.push("No plugin-observed passing evidence for acceptance criteria");
        }
      }
      
      const evidence = await listEvidenceForTask(paths, deliveryId, taskId);
      const failedEvidence = evidence.filter((e: any) => e.status === "failed");
      if (failedEvidence.length > 0) {
        reasons.push(`${failedEvidence.length} failed check(s): ${failedEvidence.map((e: any) => e.checkId).join(", ")}`);
      }
      
      return {
        allowed: reasons.length === 0,
        reasons,
        blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      };
    },
    
    async validateBlockedStatus(deliveryId: string, entityType: "delivery" | "task", entityId: string, reason: string) {
      if (!reason || reason.trim().length === 0) {
        return { allowed: false, reasons: ["Blocked status requires a non-empty reason"] };
      }
      return { allowed: true, reasons: [] };
    },
    
    requiresApproval(action: string): boolean {
      return PROTECTED_ACTIONS.includes(action as any);
    },
    
    async recordApproval(action: string, deliveryId: string, granted: boolean, reason?: string) {
      console.log(`[vstack] Approval ${granted ? "granted" : "denied"} for ${action} on ${deliveryId}: ${reason ?? "no reason"}`);
    },
    
    async checkCompletionGate(gate: CompletionGate, deliveryId: string, context: CompletionContext) {
      return checkCompletionGateImpl(paths, reviewStore, gate, deliveryId, context);
    },
    
    async validateApprovalScope(approvalId: string, action: string, targetId: string) {
      const approval = await getApprovalImpl(paths, approvalId);
      if (!approval) return false;
      
      const expectedScopeHash = createScopeHash(approval.action, approval.targetId);
      if (approval.scopeHash !== expectedScopeHash) return false;
      if (approval.action !== action) return false;
      if (approval.targetId !== targetId) return false;
      
      return true;
    },
  };
}