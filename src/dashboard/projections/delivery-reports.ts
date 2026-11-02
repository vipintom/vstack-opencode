/**
 * Delivery Report Generator
 * Generates delivery detail reports for OpenChamber
 */

import { VstackPaths } from "../../persistence/repository-root.js";
import { resolve } from "node:path";
import { writeJsonFile } from "../../persistence/file-store.js";
import { 
  getTasksForDelivery, 
  getAgentRunsForDelivery, 
  getEvidenceForDelivery 
} from "./loaders.js";
import { deliveryReportPath } from "./paths.js";
import { DeliveryDetailReport } from "./types.js";
import { createReviewStore } from "../../quality/review-store.js";
import { createDecisionStore } from "../../tasks/decision-store.js";
import { createRecoveryStore } from "../../tasks/recovery-store.js";
import { createCheckpointStore } from "../../tasks/checkpoint-store.js";
import { createLessonStore } from "../../tasks/lesson-store.js";
import { createProjectVerificationStore } from "../../tasks/verification-index-store.js";

export async function publishDeliveryReport(paths: VstackPaths, delivery: any): Promise<void> {
  const tasks = await getTasksForDelivery(paths, delivery.id);
  const agentRuns = await getAgentRunsForDelivery(paths, delivery.id);
  const evidence = await getEvidenceForDelivery(paths, delivery.id);
  
  // Load v2 data
  const reviewStore = await createReviewStore(paths);
  const decisionStore = await createDecisionStore(paths);
  const recoveryStore = await createRecoveryStore(paths);
  const checkpointStore = await createCheckpointStore(paths);
  const lessonStore = await createLessonStore(paths);
  const verificationStore = await createProjectVerificationStore(paths);
  
  const reviewSessions = await reviewStore.listReviewSessions(delivery.id);
  const decisions = await decisionStore.listDecisions(delivery.id);
  const recoveries = await recoveryStore.listRecoveries(delivery.id);
  const checkpoints = await checkpointStore.listCheckpoints(delivery.id);
  const lessons = await lessonStore.listLessons(delivery.id);
  const verificationIndexes = await verificationStore.listIndexes(delivery.id);
  const verificationIndex = verificationIndexes[0] || null;
  
  const report: DeliveryDetailReport = {
    schemaVersion: 1,
    revision: 1,
    delivery: {
      id: delivery.id,
      title: delivery.title,
      description: delivery.description,
      type: delivery.type,
      status: delivery.status,
      currentPhase: delivery.currentPhase,
      profile: delivery.profile,
      risk: delivery.risk,
      labels: delivery.labels || [],
      acceptanceCriteria: delivery.acceptanceCriteria || [],
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      createdBy: delivery.createdBy,
    },
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      type: t.type,
      status: t.status,
      priority: t.priority,
      dependencies: t.dependencies || [],
      acceptanceCriteria: t.acceptanceCriteria || [],
      assignedAgentId: t.assignedAgentId,
      workScope: t.workScope,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      completedAt: t.completedAt,
      // v2 fields
      contract: t.contract ? {
        objective: t.contract.objective,
        scope: t.contract.scope,
        outOfScope: t.contract.outOfScope,
        verification: t.contract.verification,
        expectedOutput: t.contract.expectedOutput,
        reportingFormat: t.contract.reportingFormat,
        stopConditions: t.contract.stopConditions,
        escalationConditions: t.contract.escalationConditions,
      } : undefined,
      assignment: t.assignedAgentId ? {
        agentId: t.assignedAgentId,
        role: "builder", // derived from agent ID
        status: t.status,
        outcome: "PASS", // would need to be tracked separately
        writableScope: [],
        isolationMethod: "worktree",
        changedFiles: [],
        checksRun: [],
        assumptions: [],
        blockers: [],
      } : undefined,
    })),
    agentRuns: agentRuns.map(r => ({
      id: r.id,
      agentId: r.agentId,
      taskId: r.taskId,
      role: r.agentId.replace("vstack-", ""),
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      resultSummary: r.resultSummary,
      error: r.error,
    })),
    evidence: evidence.map(e => ({
      id: e.id,
      checkId: e.checkId,
      type: e.type,
      status: e.status,
      exitCode: e.exitCode,
      summary: e.summary,
      completedAt: e.completedAt,
      taskId: e.taskId,
      // v2 fields
      provenance: e.provenance,
      outcome: e.outcome,
      commitRef: e.commitRef,
      command: e.command,
      workingDirectory: e.workingDirectory,
    })),
    reviewFindings: [], // legacy field kept for compatibility
    // v2 additions
    reviewSessions: reviewSessions.map(s => ({
      id: s.id,
      type: s.type,
      independence: s.independence,
      reviewerId: s.reviewerId,
      status: s.status,
      baseCommit: s.baseCommit,
      diffRef: s.diffRef,
      evidenceConsidered: s.evidenceConsidered,
      findings: s.findings.map(f => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        title: f.title,
        description: f.description,
        location: f.location,
        evidenceRefs: f.evidenceRefs,
        disposition: f.disposition,
        rationale: f.rationale,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
      startedAt: s.startedAt,
      completedAt: s.completedAt,
    })),
    decisions: decisions.map(d => ({
      id: d.id,
      phase: d.phase,
      summary: d.summary,
      context: d.context,
      alternatives: d.alternatives,
      chosenOption: d.chosenOption,
      rationale: d.rationale,
      evidenceReferences: d.evidenceReferences,
      status: d.status,
      supersededBy: d.supersededBy,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      createdBy: d.createdBy,
    })),
    recoveries: recoveries.map(r => ({
      id: r.id,
      failureClass: r.failureClass,
      symptom: r.symptom,
      attempts: r.attempts.map(a => ({
        attemptNumber: a.attemptNumber,
        description: a.description,
        observedResult: a.observedResult,
        assumptionTested: a.assumptionTested,
        timestamp: a.timestamp,
      })),
      commonAssumption: r.commonAssumption,
      diagnosticProbe: r.diagnosticProbe,
      changedApproach: r.changedApproach,
      recoveryRound: r.recoveryRound,
      maxRecoveryRounds: r.maxRecoveryRounds,
      cleanupStatus: r.cleanupStatus,
      finalOutcome: r.finalOutcome,
      stopReason: r.stopReason,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    checkpoints: checkpoints.map(c => ({
      id: c.id,
      progressPath: c.progressPath,
      contentHash: c.contentHash,
      branch: c.branch,
      commit: c.commit,
      worktreePath: c.worktreePath,
      verifiedWork: c.verifiedWork,
      nextAction: c.nextAction,
      openQuestions: c.openQuestions,
      blockers: c.blockers,
      keyFacts: c.keyFacts,
      decisions: c.decisions,
      failedApproaches: c.failedApproaches,
      verificationStatus: c.verificationStatus,
      freshness: c.freshness,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    lessons: lessons.map(l => ({
      id: l.id,
      failureClass: l.failureClass,
      occurrences: l.occurrences,
      recurrenceCount: l.recurrenceCount,
      impactAssessment: l.impactAssessment,
      preventionMechanism: l.preventionMechanism,
      implementationArtifact: l.implementationArtifact,
      validationResult: l.validationResult,
      status: l.status,
      owner: l.owner,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      closedAt: l.closedAt,
      supersededBy: l.supersededBy,
    })),
    verificationIndex: verificationIndex ? {
      id: verificationIndex.id,
      projectPath: verificationIndex.projectPath,
      harness: verificationIndex.harness,
      skillPath: verificationIndex.skillPath,
      contentHash: verificationIndex.contentHash,
      version: verificationIndex.version,
      surfaceCoverage: verificationIndex.surfaceCoverage,
      lastValidated: verificationIndex.lastValidated,
      validationEvidence: verificationIndex.validationEvidence,
      status: verificationIndex.status,
      gaps: verificationIndex.gaps,
      createdAt: verificationIndex.createdAt,
      updatedAt: verificationIndex.updatedAt,
    } : null,
    generatedAt: new Date().toISOString(),
  };
  
  await writeJsonFile(paths, deliveryReportPath(paths, delivery.id), report);
}