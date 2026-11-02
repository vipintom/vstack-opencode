/**
 * Projection Types
 * Shared type definitions for all projections
 */

import { Evidence } from "../../schemas/types.js";

export interface DeliveryDetailReport {
  schemaVersion: 1;
  revision: number;
  delivery: {
    id: string;
    title: string;
    description: string;
    type: string;
    status: string;
    currentPhase: string;
    profile: string;
    risk: string;
    labels: string[];
    acceptanceCriteria: string[];
    createdAt: string;
    updatedAt: string;
    createdBy: string;
  };
  tasks: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    priority: string;
    dependencies: string[];
    acceptanceCriteria: string[];
    assignedAgentId: string | null;
    workScope: string;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    // v2 fields
    contract?: {
      objective: string;
      scope: string[];
      outOfScope: string[];
      verification: string[];
      expectedOutput: string[];
      reportingFormat: string;
      stopConditions: string[];
      escalationConditions: string[];
    };
    assignment?: {
      agentId: string;
      role: string;
      status: string;
      outcome: string | null;
      writableScope: string[];
      isolationMethod: string;
      changedFiles: string[];
      checksRun: string[];
      assumptions: string[];
      blockers: string[];
    };
  }>;
  agentRuns: Array<{
    id: string;
    agentId: string;
    taskId: string | null;
    role: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    resultSummary: string | null;
    error: string | null;
  }>;
  evidence: Array<{
    id: string;
    checkId: string;
    type: string;
    status: string;
    exitCode: number | null;
    summary: string;
    completedAt: string;
    taskId: string | null;
    // v2 fields
    provenance?: string;
    outcome?: string;
    commitRef?: string;
    command?: string[];
    workingDirectory?: string;
  }>;
  reviewFindings: Array<{
    id: string;
    severity: string;
    category: string;
    title: string;
    status: string;
    taskId: string | null;
  }>;
  // v2 additions
  reviewSessions: Array<{
    id: string;
    type: string;
    independence: string;
    reviewerId: string;
    status: string;
    baseCommit: string;
    diffRef: string | null;
    evidenceConsidered: string[];
    findings: Array<{
      id: string;
      severity: string;
      category: string;
      title: string;
      description: string;
      location: string;
      evidenceRefs: string[];
      disposition: string;
      rationale: string;
      createdAt: string;
      updatedAt: string;
    }>;
    startedAt: string;
    completedAt: string | null;
  }>;
  decisions: Array<{
    id: string;
    phase: string;
    summary: string;
    context: string;
    alternatives: string[];
    chosenOption: string;
    rationale: string;
    evidenceReferences: string[];
    status: string;
    supersededBy: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
  }>;
  recoveries: Array<{
    id: string;
    failureClass: string;
    symptom: string;
    attempts: Array<{
      attemptNumber: number;
      description: string;
      observedResult: string;
      assumptionTested: string;
      timestamp: string;
    }>;
    commonAssumption: string;
    diagnosticProbe: {
      description: string;
      command: string[];
      result: string;
    } | null;
    changedApproach: string | null;
    recoveryRound: number;
    maxRecoveryRounds: number;
    cleanupStatus: string;
    finalOutcome: string;
    stopReason: string;
    createdAt: string;
    updatedAt: string;
  }>;
  checkpoints: Array<{
    id: string;
    progressPath: string;
    contentHash: string;
    branch: string;
    commit: string;
    worktreePath: string | null;
    verifiedWork: string[];
    nextAction: string;
    openQuestions: string[];
    blockers: string[];
    keyFacts: Record<string, string>;
    decisions: string[];
    failedApproaches: string[];
    verificationStatus: {
      passed: string[];
      failed: string[];
      skipped: string[];
      remaining: string[];
    };
    freshness: string;
    createdAt: string;
    updatedAt: string;
  }>;
  lessons: Array<{
    id: string;
    failureClass: string;
    occurrences: string[];
    recurrenceCount: number;
    impactAssessment: string;
    preventionMechanism: string;
    implementationArtifact: string | null;
    validationResult: string | null;
    status: string;
    owner: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    supersededBy: string | null;
  }>;
  verificationIndex: {
    id: string;
    projectPath: string;
    harness: string;
    skillPath: string;
    contentHash: string;
    version: string;
    surfaceCoverage: string[];
    lastValidated: string;
    validationEvidence: string[];
    status: string;
    gaps: string[];
    createdAt: string;
    updatedAt: string;
  } | null;
  generatedAt: string;
}

export interface ActivitySummary {
  schemaVersion: 1;
  revision: number;
  deliveryId: string;
  activities: Array<{
    timestamp: string;
    eventType: string;
    actor: string;
    entity: { type: string; id: string };
    summary: string;
    outcome?: string;
  }>;
  generatedAt: string;
}

export interface MemoryIndexReport {
  schemaVersion: 1;
  revision: number;
  categories: Record<string, Array<{
    id: string;
    title: string;
    category: string;
    status: string;
    updatedAt: string;
    tags: string[];
  }>>;
  generatedAt: string;
}

export interface QualitySummaryReport {
  schemaVersion: 1;
  revision: number;
  deliveryId: string;
  checksTotal: number;
  checksPassed: number;
  checksFailed: number;
  checksSkipped: number;
  checksByType: Record<string, { passed: number; failed: number }>;
  reviewFindings: { critical: number; high: number; medium: number; low: number };
  generatedAt: string;
}