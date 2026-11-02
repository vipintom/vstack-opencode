/**
 * vstack Phase 2 Tools - Assignment, Decision, Checkpoint, Lesson, Recovery, Verification
 */

import { VstackTool } from "./index.js";
import { resolve } from "node:path";
import { listFiles, readJsonFile } from "../persistence/file-store.js";
import { VstackPaths } from "../persistence/repository-root.js";

// Assignment Tools
export const assignmentTool: VstackTool = {
  name: "vstack_assignment",
  description: "Manage worker assignments with task contracts and write-scope conflict detection",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "check-conflict", "validate-outcome", "by-task"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID" },
      assignmentId: { type: "string", description: "Assignment ID (for get/update)" },
      taskId: { type: "string", description: "Task ID (for create/by-task)" },
      agentId: { type: "string", description: "Agent ID (for create)" },
      sessionId: { type: "string", description: "Session ID (for create)" },
      role: { type: "string", enum: ["lead", "builder", "reviewer"], description: "Role (for create)" },
      contract: { type: "object", description: "Task contract (for create)" },
      baseState: { type: "object", description: "Base state with commit, worktreePath, branch (for create)" },
      writableScope: { type: "array", items: { type: "string" }, description: "Writable paths (for create/check-conflict)" },
      isolationMethod: { type: "string", enum: ["worktree", "branch", "directory", "sequential"], description: "Isolation method (for create)" },
      dispatchPrompt: { type: "string", description: "Dispatch prompt (for create)" },
      contextReferences: { type: "array", items: { type: "string" }, description: "Context references (for create)" },
      status: { type: "string", enum: ["dispatched", "running", "completed", "failed", "cancelled", "blocked"], description: "Status (for update)" },
      outcome: { type: "string", enum: ["PASS", "ISSUES", "BLOCKED"], description: "Outcome (for update/validate-outcome)" },
      completedAt: { type: "string", description: "Completion timestamp (for update)" },
      changedFiles: { type: "array", items: { type: "string" }, description: "Changed files (for update)" },
      artifactPaths: { type: "array", items: { type: "string" }, description: "Artifact paths (for update)" },
      checksRun: { type: "array", items: { type: "string" }, description: "Checks run (for update)" },
      evidenceIds: { type: "array", items: { type: "string" }, description: "Evidence IDs (for update)" },
      assumptions: { type: "array", items: { type: "string" }, description: "Assumptions (for update)" },
      blockers: { type: "array", items: { type: "string" }, description: "Blockers (for update)" },
      handoffSummary: { type: "string", description: "Handoff summary (for update)" },
      evidence: { type: "object", description: "Evidence for outcome validation (for validate-outcome)" },
      filters: { type: "object", description: "Filters for list (status, role, taskId, outcome)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { assignmentStore } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.taskId || !input.agentId || !input.sessionId || !input.role || !input.contract || !input.baseState || !input.writableScope || !input.isolationMethod || !input.dispatchPrompt) {
          return { content: JSON.stringify({ error: "deliveryId, taskId, agentId, sessionId, role, contract, baseState, writableScope, isolationMethod, dispatchPrompt required" }) };
        }
        const assignment = await assignmentStore.createAssignment({
          deliveryId: input.deliveryId,
          taskId: input.taskId as any,
          agentId: input.agentId,
          sessionId: input.sessionId,
          role: input.role as any,
          contract: input.contract as any,
          baseState: input.baseState as any,
          writableScope: input.writableScope,
          isolationMethod: input.isolationMethod as any,
          dispatchPrompt: input.dispatchPrompt,
          contextReferences: input.contextReferences || [],
        });
        return { content: JSON.stringify({ assignment }) };
      }
      
      case "get": {
        if (!input.assignmentId) return { content: JSON.stringify({ error: "assignmentId required" }) };
        const assignment = await assignmentStore.getAssignment(input.assignmentId);
        return { content: JSON.stringify({ assignment }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const assignments = await assignmentStore.listAssignments(input.deliveryId, input.filters as any);
        return { content: JSON.stringify({ assignments }) };
      }
      
      case "update": {
        if (!input.assignmentId) return { content: JSON.stringify({ error: "assignmentId required" }) };
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.outcome) updates.outcome = input.outcome;
        if (input.completedAt) updates.completedAt = input.completedAt;
        if (input.changedFiles) updates.changedFiles = input.changedFiles;
        if (input.artifactPaths) updates.artifactPaths = input.artifactPaths;
        if (input.checksRun) updates.checksRun = input.checksRun;
        if (input.evidenceIds) updates.evidenceIds = input.evidenceIds;
        if (input.assumptions) updates.assumptions = input.assumptions;
        if (input.blockers) updates.blockers = input.blockers;
        if (input.handoffSummary) updates.handoffSummary = input.handoffSummary;
        const assignment = await assignmentStore.updateAssignment(input.assignmentId, updates);
        return { content: JSON.stringify({ assignment }) };
      }
      
      case "check-conflict": {
        if (!input.deliveryId || !input.writableScope) {
          return { content: JSON.stringify({ error: "deliveryId and writableScope required" }) };
        }
        const conflicts = await assignmentStore.checkWriteScopeConflict(input.deliveryId, input.writableScope, input.assignmentId);
        return { content: JSON.stringify({ conflicts }) };
      }
      
      case "validate-outcome": {
        if (!input.assignmentId || !input.outcome || !input.evidence) {
          return { content: JSON.stringify({ error: "assignmentId, outcome, evidence required" }) };
        }
        const valid = await assignmentStore.validateAssignmentOutcome(input.assignmentId, input.outcome as any, input.evidence as any);
        return { content: JSON.stringify({ valid }) };
      }
      
      case "by-task": {
        if (!input.taskId) return { content: JSON.stringify({ error: "taskId required" }) };
        const assignment = await assignmentStore.getAssignmentByTask(input.taskId as any);
        return { content: JSON.stringify({ assignment }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

// Decision Tools
export const decisionTool: VstackTool = {
  name: "vstack_decision",
  description: "Manage engineering decision records",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "supersede"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID" },
      decisionId: { type: "string", description: "Decision ID (for get/update/supersede)" },
      taskId: { type: "string", description: "Task ID (for create)" },
      phase: { type: "string", description: "Phase (for create)" },
      summary: { type: "string", description: "Summary (for create)" },
      context: { type: "string", description: "Context (for create)" },
      alternatives: { type: "array", items: { type: "string" }, description: "Alternatives (for create)" },
      chosenOption: { type: "string", description: "Chosen option (for create)" },
      rationale: { type: "string", description: "Rationale (for create)" },
      evidenceReferences: { type: "array", items: { type: "string" }, description: "Evidence references (for create)" },
      createdBy: { type: "string", description: "Created by (for create)" },
      status: { type: "string", enum: ["active", "superseded", "reverted"], description: "Status (for update)" },
      newDecisionId: { type: "string", description: "New decision ID (for supersede)" },
      filters: { type: "object", description: "Filters for list (status, phase, taskId)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { decisionStore } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.phase || !input.summary || !input.context || !input.alternatives || !input.chosenOption || !input.rationale || !input.evidenceReferences || !input.createdBy) {
          return { content: JSON.stringify({ error: "deliveryId, phase, summary, context, alternatives, chosenOption, rationale, evidenceReferences, createdBy required" }) };
        }
        const decision = await decisionStore.createDecision({
          deliveryId: input.deliveryId,
          taskId: input.taskId as any,
          phase: input.phase,
          summary: input.summary,
          context: input.context,
          alternatives: input.alternatives,
          chosenOption: input.chosenOption,
          rationale: input.rationale,
          evidenceReferences: input.evidenceReferences,
          createdBy: input.createdBy,
        });
        return { content: JSON.stringify({ decision }) };
      }
      
      case "get": {
        if (!input.decisionId) return { content: JSON.stringify({ error: "decisionId required" }) };
        const decision = await decisionStore.getDecision(input.decisionId);
        return { content: JSON.stringify({ decision }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const decisions = await decisionStore.listDecisions(input.deliveryId, input.filters as any);
        return { content: JSON.stringify({ decisions }) };
      }
      
      case "update": {
        if (!input.decisionId) return { content: JSON.stringify({ error: "decisionId required" }) };
        const updates: any = {};
        if (input.status) updates.status = input.status;
        if (input.rationale) updates.rationale = input.rationale;
        if (input.evidenceReferences) updates.evidenceReferences = input.evidenceReferences;
        if (input.newDecisionId) updates.supersededBy = input.newDecisionId;
        const decision = await decisionStore.updateDecision(input.decisionId, updates);
        return { content: JSON.stringify({ decision }) };
      }
      
      case "supersede": {
        if (!input.decisionId || !input.newDecisionId) {
          return { content: JSON.stringify({ error: "decisionId and newDecisionId required" }) };
        }
        await decisionStore.supersedeDecision(input.decisionId, input.newDecisionId);
        return { content: JSON.stringify({ success: true }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

// Checkpoint Tools
export const checkpointTool: VstackTool = {
  name: "vstack_checkpoint",
  description: "Manage progress checkpoints (PROGRESS.md integration)",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "revalidate", "latest"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID" },
      checkpointId: { type: "string", description: "Checkpoint ID (for get/update/revalidate)" },
      taskId: { type: "string", description: "Task ID (for create)" },
      progressPath: { type: "string", description: "Path to PROGRESS.md (for create)" },
      branch: { type: "string", description: "Branch (for create)" },
      commit: { type: "string", description: "Commit SHA (for create)" },
      worktreePath: { type: "string", description: "Worktree path (for create)" },
      verifiedWork: { type: "array", items: { type: "string" }, description: "Verified work task IDs (for create)" },
      nextAction: { type: "string", description: "Next action (for create)" },
      openQuestions: { type: "array", items: { type: "string" }, description: "Open questions (for create)" },
      blockers: { type: "array", items: { type: "string" }, description: "Blockers (for create)" },
      keyFacts: { type: "object", description: "Key facts (for create)" },
      decisions: { type: "array", items: { type: "string" }, description: "Decision IDs (for create)" },
      failedApproaches: { type: "array", items: { type: "string" }, description: "Failed approaches (for create)" },
      verificationStatus: { type: "object", description: "Verification status (for create)" },
      updates: { type: "object", description: "Updates for update action" },
      repoState: { type: "object", description: "Current repo state for revalidation (branch, commit, worktreePath, dirtyFiles)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { checkpointStore } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.progressPath || !input.branch || !input.commit || !input.verifiedWork || !input.nextAction) {
          return { content: JSON.stringify({ error: "deliveryId, progressPath, branch, commit, verifiedWork, nextAction required" }) };
        }
        const checkpoint = await checkpointStore.createCheckpoint({
          deliveryId: input.deliveryId,
          taskId: input.taskId as any,
          progressPath: input.progressPath,
          branch: input.branch,
          commit: input.commit,
          worktreePath: input.worktreePath || null,
          verifiedWork: input.verifiedWork,
          nextAction: input.nextAction,
          openQuestions: input.openQuestions || [],
          blockers: input.blockers || [],
          keyFacts: input.keyFacts || {},
          decisions: input.decisions || [],
          failedApproaches: input.failedApproaches || [],
          verificationStatus: input.verificationStatus || { passed: [], failed: [], skipped: [], remaining: [] },
        });
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "get": {
        if (!input.checkpointId) return { content: JSON.stringify({ error: "checkpointId required" }) };
        const checkpoint = await checkpointStore.getCheckpoint(input.checkpointId);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const checkpoints = await checkpointStore.listCheckpoints(input.deliveryId);
        return { content: JSON.stringify({ checkpoints }) };
      }
      
      case "update": {
        if (!input.checkpointId || !input.updates) {
          return { content: JSON.stringify({ error: "checkpointId and updates required" }) };
        }
        const checkpoint = await checkpointStore.updateCheckpoint(input.checkpointId, input.updates as any);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "revalidate": {
        if (!input.checkpointId || !input.repoState) {
          return { content: JSON.stringify({ error: "checkpointId and repoState required" }) };
        }
        const checkpoint = await checkpointStore.revalidateCheckpoint(input.checkpointId, input.repoState as any);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      case "latest": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const checkpoint = await checkpointStore.getLatestCheckpoint(input.deliveryId);
        return { content: JSON.stringify({ checkpoint }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

// Lesson Tools
export const lessonTool: VstackTool = {
  name: "vstack_lesson",
  description: "Manage lesson lifecycle (Candidate → Assessed → Promoted → Verified → Closed/Superseded)",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "promote", "verify", "close"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID" },
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
      filters: { type: "object", description: "Filters for list (status, failureClass, taskId)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { lessonStore } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.failureClass || !input.occurrences || !input.recurrenceCount || !input.impactAssessment || !input.owner) {
          return { content: JSON.stringify({ error: "deliveryId, failureClass, occurrences, recurrenceCount, impactAssessment, owner required" }) };
        }
        const lesson = await lessonStore.createLesson({
          deliveryId: input.deliveryId,
          taskId: input.taskId as any,
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
        const lessons = await lessonStore.listLessons(input.deliveryId, input.filters as any);
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

// Recovery Tools
export const recoveryTool: VstackTool = {
  name: "vstack_recovery",
  description: "Manage bounded recovery records for repeated failure handling",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "record-attempt", "set-probe", "set-approach", "complete"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID" },
      recoveryId: { type: "string", description: "Recovery ID (for get/update/record-attempt/set-probe/set-approach/complete)" },
      taskId: { type: "string", description: "Task ID (for create)" },
      failureClass: { type: "string", description: "Failure class (for create)" },
      symptom: { type: "string", description: "Symptom (for create)" },
      maxRecoveryRounds: { type: "number", description: "Max recovery rounds (for create)" },
      attempt: { type: "object", description: "Attempt details (for record-attempt)" },
      probe: { type: "object", description: "Diagnostic probe (for set-probe)" },
      approach: { type: "string", description: "Changed approach (for set-approach)" },
      outcome: { type: "string", enum: ["resolved", "escalated", "blocked"], description: "Final outcome (for complete)" },
      stopReason: { type: "string", description: "Stop reason (for complete)" },
      cleanupStatus: { type: "string", enum: ["pending", "completed", "failed"], description: "Cleanup status (for update)" },
      filters: { type: "object", description: "Filters for list (finalOutcome, taskId)" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { recoveryStore } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.failureClass || !input.symptom || !input.maxRecoveryRounds) {
          return { content: JSON.stringify({ error: "deliveryId, failureClass, symptom, maxRecoveryRounds required" }) };
        }
        const recovery = await recoveryStore.createRecovery({
          deliveryId: input.deliveryId,
          taskId: input.taskId as any,
          failureClass: input.failureClass,
          symptom: input.symptom,
          maxRecoveryRounds: input.maxRecoveryRounds,
        });
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "get": {
        if (!input.recoveryId) return { content: JSON.stringify({ error: "recoveryId required" }) };
        const recovery = await recoveryStore.getRecovery(input.recoveryId);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const recoveries = await recoveryStore.listRecoveries(input.deliveryId, input.filters as any);
        return { content: JSON.stringify({ recoveries }) };
      }
      
      case "update": {
        if (!input.recoveryId) return { content: JSON.stringify({ error: "recoveryId required" }) };
        const updates: any = {};
        if (input.cleanupStatus) updates.cleanupStatus = input.cleanupStatus;
        if (input.outcome) updates.finalOutcome = input.outcome;
        if (input.stopReason) updates.stopReason = input.stopReason;
        const recovery = await recoveryStore.updateRecovery(input.recoveryId, updates);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "record-attempt": {
        if (!input.recoveryId || !input.attempt) {
          return { content: JSON.stringify({ error: "recoveryId and attempt required" }) };
        }
        const recovery = await recoveryStore.recordAttempt(input.recoveryId, input.attempt as any);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "set-probe": {
        if (!input.recoveryId || !input.probe) {
          return { content: JSON.stringify({ error: "recoveryId and probe required" }) };
        }
        const recovery = await recoveryStore.setDiagnosticProbe(input.recoveryId, input.probe as any);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "set-approach": {
        if (!input.recoveryId || !input.approach) {
          return { content: JSON.stringify({ error: "recoveryId and approach required" }) };
        }
        const recovery = await recoveryStore.setChangedApproach(input.recoveryId, input.approach);
        return { content: JSON.stringify({ recovery }) };
      }
      
      case "complete": {
        if (!input.recoveryId || !input.outcome || !input.stopReason) {
          return { content: JSON.stringify({ error: "recoveryId, outcome, stopReason required" }) };
        }
        const recovery = await recoveryStore.completeRecovery(input.recoveryId, input.outcome as any, input.stopReason);
        return { content: JSON.stringify({ recovery }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

// Verification Index Tools
export const verificationTool: VstackTool = {
  name: "vstack_verification",
  description: "Manage project verification skill indexes",
  input: {
    type: "object",
    properties: {
      action: { 
        type: "string", 
        enum: ["create", "get", "list", "update", "validate", "by-path"],
        description: "Action to perform" 
      },
      deliveryId: { type: "string", description: "Delivery ID" },
      indexId: { type: "string", description: "Index ID (for get/update/validate)" },
      projectPath: { type: "string", description: "Project path (for create)" },
      harness: { type: "string", enum: ["opencode", "codex", "claude-code", "other"], description: "Harness (for create)" },
      skillPath: { type: "string", description: "Skill path (for create/by-path)" },
      version: { type: "string", description: "Version (for create)" },
      surfaceCoverage: { type: "array", items: { type: "string" }, description: "Surface coverage (for create)" },
      gaps: { type: "array", items: { type: "string" }, description: "Gaps (for create)" },
      updates: { type: "object", description: "Updates for update action" },
    },
    required: ["action"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { verificationIndexStore } = vstack;
    
    switch (input.action) {
      case "create": {
        if (!input.deliveryId || !input.projectPath || !input.harness || !input.skillPath || !input.version || !input.surfaceCoverage) {
          return { content: JSON.stringify({ error: "deliveryId, projectPath, harness, skillPath, version, surfaceCoverage required" }) };
        }
        const index = await verificationIndexStore.createIndex({
          deliveryId: input.deliveryId,
          projectPath: input.projectPath,
          harness: input.harness as any,
          skillPath: input.skillPath,
          version: input.version,
          surfaceCoverage: input.surfaceCoverage,
          gaps: input.gaps || [],
        });
        return { content: JSON.stringify({ index }) };
      }
      
      case "get": {
        if (!input.indexId) return { content: JSON.stringify({ error: "indexId required" }) };
        const index = await verificationIndexStore.getIndex(input.indexId);
        return { content: JSON.stringify({ index }) };
      }
      
      case "list": {
        if (!input.deliveryId) return { content: JSON.stringify({ error: "deliveryId required" }) };
        const indexes = await verificationIndexStore.listIndexes(input.deliveryId);
        return { content: JSON.stringify({ indexes }) };
      }
      
      case "update": {
        if (!input.indexId || !input.updates) {
          return { content: JSON.stringify({ error: "indexId and updates required" }) };
        }
        const index = await verificationIndexStore.updateIndex(input.indexId, input.updates as any);
        return { content: JSON.stringify({ index }) };
      }
      
      case "validate": {
        if (!input.indexId) return { content: JSON.stringify({ error: "indexId required" }) };
        const index = await verificationIndexStore.validateFreshness(input.indexId);
        return { content: JSON.stringify({ index }) };
      }
      
      case "by-path": {
        if (!input.skillPath) return { content: JSON.stringify({ error: "skillPath required" }) };
        const index = await verificationIndexStore.getIndexByPath(input.skillPath);
        return { content: JSON.stringify({ index }) };
      }
      
      default:
        return { content: JSON.stringify({ error: "Invalid action" }) };
    }
  },
};

// Session Pickup Tool
export const sessionPickupTool: VstackTool = {
  name: "vstack_session_pickup",
  description: "Validate repository state against checkpoints for safe session resumption",
  input: {
    type: "object",
    properties: {
      deliveryId: { type: "string", description: "Delivery ID" },
    },
    required: ["deliveryId"],
  },
  execute: async (input, context) => {
    const { vstack } = context;
    const { 
      checkpointStore, 
      taskStore, 
      deliveryStore, 
      agentRunStore, 
      evidenceStore, 
      historyService,
      vstackRoot 
    } = vstack;
    
    const { performSessionPickup } = await import("../util/session-pickup.js");
    const paths: VstackPaths = vstackRoot;
    
    const result = await performSessionPickup(
      paths,
      input.deliveryId,
      checkpointStore,
      taskStore,
      deliveryStore,
      agentRunStore,
      evidenceStore,
      historyService
    );
    
    return { content: JSON.stringify(result) };
  },
};

export const phase2Tools = [
  assignmentTool,
  decisionTool,
  checkpointTool,
  lessonTool,
  recoveryTool,
  verificationTool,
  sessionPickupTool,
];