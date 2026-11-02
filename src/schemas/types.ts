/**
 * vstack Workflow State Types
 * Core domain types for delivery lifecycle, tasks, evidence, and events
 */

// Delivery lifecycle phases
export type DeliveryPhase =
  | "intake"
  | "discovery"
  | "design"
  | "planning"
  | "implementation"
  | "validation"
  | "review"
  | "release_preparation"
  | "deployment"
  | "post_release"
  | "completed";

// Delivery status
export type DeliveryStatus =
  | "proposed"
  | "active"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

// Phase run status
export type PhaseRunStatus =
  | "not_started"
  | "ready"
  | "active"
  | "waiting_for_approval"
  | "blocked"
  | "verifying"
  | "completed"
  | "skipped"
  | "failed"
  | "cancelled";

// Task status
export type TaskStatus =
  | "pending"
  | "ready"
  | "assigned"
  | "in_progress"
  | "review"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "skipped"
  | "needs_rework";

// Agent run status
export type AgentRunStatus =
  | "dispatched"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// Task type
export type TaskType =
  | "discovery"
  | "design"
  | "planning"
  | "implementation"
  | "testing"
  | "review"
  | "documentation"
  | "release"
  | "deployment"
  | "operations"
  | "other";

// Delivery type
export type DeliveryType =
  | "feature"
  | "bugfix"
  | "refactor"
  | "migration"
  | "infrastructure"
  | "documentation"
  | "operations"
  | "release"
  | "other";

// Profile ID
export type ProfileId =
  | "bug-fix"
  | "feature"
  | "refactor"
  | "architecture-change"
  | "infrastructure-change"
  | "documentation"
  | "release-only";

// Evidence types
export type EvidenceType =
  | "build"
  | "lint"
  | "typecheck"
  | "test:unit"
  | "test:integration"
  | "test:e2e"
  | "coverage"
  | "security:deps"
  | "security:secrets"
  | "security:review"
  | "architecture:review"
  | "acceptance"
  | "release:artifacts"
  | "deploy:health"
  | "manual_attestation"
  | "other";

// Evidence source / provenance
export type EvidenceProvenance =
  | "plugin_observed"
  | "agent_reported"
  | "external_system"
  | "user_supplied";

// Evidence source (legacy, kept for compatibility)
export type EvidenceSource =
  | "plugin_execution"
  | "agent_review"
  | "human_approval"
  | "external_ci"
  | "manual_attestation";

// Evidence outcome
export type EvidenceOutcome =
  | "passed"
  | "failed"
  | "skipped"
  | "not_run"
  | "blocked"
  | "unavailable"
  | "inconclusive";

// Finding severity
export type FindingSeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

// Finding status
export type FindingStatus =
  | "open"
  | "accepted"
  | "fixed"
  | "false_positive"
  | "deferred";

// Review lens
export type ReviewLens =
  | "correctness_regression"
  | "architecture_design"
  | "security_data"
  | "performance_resources"
  | "maintainability_style"
  | "test_adequacy"
  | "documentation_migration";

// Approval status
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

// Core ID types
export type DeliveryId = string & { readonly __brand: unique symbol };
export type PhaseRunId = string & { readonly __brand: unique symbol };
export type TaskId = string & { readonly __brand: unique symbol };
export type AgentRunId = string & { readonly __brand: unique symbol };
export type ReviewRunId = string & { readonly __brand: unique symbol };
export type FindingId = string & { readonly __brand: unique symbol };
export type EvidenceId = string & { readonly __brand: unique symbol };
export type ApprovalId = string & { readonly __brand: unique symbol };
export type EventId = string & { readonly __brand: unique symbol };

// Helper functions for ID creation
export function deliveryId(id: string): DeliveryId { return id as DeliveryId; }
export function phaseRunId(id: string): PhaseRunId { return id as PhaseRunId; }
export function taskId(id: string): TaskId { return id as TaskId; }
export function agentRunId(id: string): AgentRunId { return id as AgentRunId; }
export function reviewRunId(id: string): ReviewRunId { return id as ReviewRunId; }
export function findingId(id: string): FindingId { return id as FindingId; }
export function evidenceId(id: string): EvidenceId { return id as EvidenceId; }
export function approvalId(id: string): ApprovalId { return id as ApprovalId; }
export function eventId(id: string): EventId { return id as EventId; }

// Delivery entity
export interface Delivery {
  schemaVersion: 1;
  id: DeliveryId;
  title: string;
  description: string;
  type: DeliveryType;
  profile: ProfileId;
  status: DeliveryStatus;
  currentPhase: DeliveryPhase;
  currentPhaseRunId: PhaseRunId | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  revision: number;
  acceptanceCriteria: string[];
  risk: "low" | "medium" | "high" | "critical";
  labels: string[];
  references: {
    request?: string;
    discovery?: string;
    design?: string;
    plan?: string;
    releaseNotes?: string;
    postRelease?: string;
  };
  createdBy: string; // agent/session ID
}

// Phase run record
export interface PhaseRun {
  schemaVersion: 1;
  id: PhaseRunId;
  deliveryId: DeliveryId;
  phase: DeliveryPhase;
  runSequence: number; // for re-entry
  status: PhaseRunStatus;
  startedAt: string | null;
  completedAt: string | null;
  blockedAt: string | null;
  blockedReason: string | null;
  approvalRequired: boolean;
  approvalId: ApprovalId | null;
  gateResults: GateResult[];
  requiredGates: string[]; // gate IDs
  optionalGates: string[];
  skipReason: string | null;
  skipBy: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface GateResult {
  gateId: string;
  status: "passed" | "failed" | "pending" | "skipped";
  evaluatedAt: string;
  evidenceIds: EvidenceId[];
  details: Record<string, unknown>;
}

// Task entity
export interface Task {
  schemaVersion: 1;
  id: TaskId;
  deliveryId: DeliveryId;
  phaseRunId: PhaseRunId;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: "low" | "medium" | "high" | "critical";
  dependencies: TaskId[]; // task IDs that must complete first
  assignedAgentId: string | null; // vstack-* agent ID
  assignedSessionId: string | null; // OpenCode session ID
  workScope: string; // files/modules/directories or textual boundary
  acceptanceCriteria: string[];
  expectedOutputs: string[];
  requiredSkills: string[]; // skill IDs
  worktreePath: string | null;
  attemptCount: number;
  maxAttempts: number;
  resultSummary: string | null;
  evidenceIds: EvidenceId[];
  blocker: Blocker | null;
  contract: TaskContract | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  startedAt: string | null;
}

export interface Blocker {
  type: "dependency" | "external" | "resource" | "approval" | "technical" | "other";
  message: string;
  details: Record<string, unknown>;
  at: string;
  blockingTaskIds: TaskId[];
}

// Agent run record
export interface AgentRun {
  schemaVersion: 1;
  id: AgentRunId;
  deliveryId: DeliveryId;
  taskId: TaskId | null;
  agentId: string; // vstack-* agent ID
  sessionId: string; // OpenCode session ID
  worktreePath: string | null;
  status: "dispatched" | "running" | "completed" | "failed" | "cancelled";
  dispatchPrompt: string;
  contextReferences: string[]; // paths to context files
  startedAt: string;
  completedAt: string | null;
  resultSummary: string | null;
  error: string | null;
  handoffSummary: string | null;
  revision: number;
}

// Review run record
export interface ReviewRun {
  schemaVersion: 1;
  id: ReviewRunId;
  deliveryId: DeliveryId;
  phaseRunId: PhaseRunId | null;
  profile: "quick" | "full" | "custom";
  reviewers: ReviewerAssignment[];
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  targetArtifacts: string[]; // paths or diff refs
  scope: string;
  acceptanceRequirements: string[];
  findings: FindingId[];
  consolidatedReportPath: string | null;
  startedAt: string;
  completedAt: string | null;
  revision: number;
}

export interface ReviewerAssignment {
  agentId: string; // vstack-reviewer (always same agent ID, different sessions)
  lens: ReviewLens;
  sessionId: string | null;
  status: "pending" | "running" | "completed" | "failed";
  reportPath: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

// Finding record
export interface Finding {
  schemaVersion: 1;
  id: FindingId;
  deliveryId: DeliveryId;
  reviewRunId: ReviewRunId;
  reviewerAgentId: string;
  lens: ReviewLens;
  severity: FindingSeverity;
  category: string;
  title: string;
  explanation: string;
  filePath: string | null;
  lineRange: { start: number; end: number } | null;
  reproducibility: string | null;
  recommendation: string;
  status: FindingStatus;
  owner: string | null; // assigned agent for remediation
  remediationTaskId: TaskId | null;
  resolutionEvidenceIds: EvidenceId[];
  firstSeenReviewRunId: ReviewRunId;
  lastReviewedReviewRunId: ReviewRunId | null;
  createdAt: string;
  updatedAt: string;
}

// Evidence record
export interface Evidence {
  schemaVersion: 1;
  id: EvidenceId;
  deliveryId: DeliveryId;
  taskId: TaskId | null;
  phaseRunId: PhaseRunId | null;
  type: EvidenceType;
  source: EvidenceSource;
  provenance: EvidenceProvenance;
  outcome: EvidenceOutcome;
  checkId: string; // e.g., "test:unit", "build", "lint"
  command: string[]; // argv array (no shell concatenation)
  workingDirectory: string;
  commitRef: string; // git commit SHA
  startedAt: string;
  completedAt: string;
  exitCode: number | null;
  status: "passed" | "failed" | "error" | "timeout" | "cancelled";
  stdoutPath: string | null; // path to stdout log (bounded)
  stderrPath: string | null; // path to stderr log (bounded)
  summary: string;
  executionId: string; // tool/session/run ID
  sessionId: string | null;
  agentRunId: AgentRunId | null;
  metadata: Record<string, unknown>;
  revision: number;
}

// Review types for v2
export type ReviewType = "code" | "design" | "security" | "architecture" | "release" | "post_mortem" | "other";

export type ReviewIndependence = "confirmed" | "declared" | "not_independent" | "unknown";

export type FindingCategory = "security" | "correctness" | "performance" | "maintainability" | "style" | "architecture" | "testing" | "documentation" | "other";

export type FindingDisposition = "open" | "fixed" | "dismissed" | "deferred" | "accepted_risk";

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  description: string;
  location: string; // file:line or module
  evidenceRefs: EvidenceId[];
  disposition: FindingDisposition;
  rationale: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSession {
  schemaVersion: 1;
  id: string; // ReviewSessionId
  deliveryId: DeliveryId;
  taskId: TaskId | null;
  phaseRunId: PhaseRunId | null;
  type: ReviewType;
  independence: ReviewIndependence;
  reviewerId: string;
  reviewerSessionId: string | null;
  baseCommit: string;
  diffRef: string | null;
  evidenceConsidered: EvidenceId[];
  findings: ReviewFinding[];
  status: "in_progress" | "completed" | "timed_out" | "unavailable" | "cancelled";
  startedAt: string;
  completedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// Approval record
export interface Approval {
  schemaVersion: 1;
  id: ApprovalId;
  deliveryId: DeliveryId;
  phaseRunId: PhaseRunId | null;
  type: "design" | "release" | "publish" | "production_deployment" | "destructive_migration" | "rollback" | "scope_change" | "other";
  title: string;
  description: string;
  requestedBy: string;
  requestedAt: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

// Event record (append-only log)
export interface Event {
  schemaVersion: 1;
  eventId: EventId;
  sequence: number; // monotonically increasing
  timestamp: string; // ISO 8601
  actor: {
    type: "plugin" | "agent" | "human" | "system";
    id: string; // agent ID, session ID, or "user"
  };
  entity: {
    type: "delivery" | "phase" | "task" | "agent_run" | "review" | "finding" | "evidence" | "approval";
    id: string;
  };
  deliveryId: DeliveryId;
  eventType: EventType;
  payload: Record<string, unknown>;
  source: {
    sessionId: string | null;
    toolId: string | null;
  };
}

// Project configuration
export interface ProjectConfig {
  schemaVersion: 1;
  project: {
    name: string;
    defaultProfile: ProfileId;
  };
  orchestration: {
    mode: "assisted" | "supervised" | "autonomous";
    maxConcurrentAgents: number;
    maxRetriesPerTask: number;
    maxReviewRuns: number;
    allowParallelTasks: boolean;
    requireTaskAcceptanceCriteria: boolean;
  };
  review: {
    defaultProfile: "quick" | "full";
    quick: {
      independent: boolean;
      requiredLenses: ReviewLens[];
    };
    full: {
      independent: boolean;
      riskBasedLenses: ReviewLens[];
    };
  };
  approvals: {
    designApproval: boolean;
    releaseApproval: boolean;
    publishApproval: boolean;
    productionDeploymentApproval: boolean;
    destructiveMigrationApproval: boolean;
  };
  quality: {
    requireBuild: boolean;
    requireConfiguredTests: boolean;
    requireIndependentReview: boolean;
    requireCurrentRevisionEvidence: boolean;
  };
  worktrees: {
    enabled: boolean;
    strategy: "opencode-native";
    maxConcurrentWorktrees: number;
  };
  gitTracking: {
    trackConfig: boolean;
    trackProfiles: boolean;
    trackDeliveryState: boolean;
    trackEvidence: boolean;
    trackEvents: boolean;
  };
}

// Manifest file
export interface Manifest {
  schemaVersion: 1;
  vstackVersion: string;
  contentVersion: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// v2 Phase 2 Types: Task Contracts, Assignments, Checkpoints, Decisions, Lessons, Recoveries
// ============================================================================

// Task Contract (v2) - structured contract for worker assignments
export interface TaskContract {
  objective: string;
  scope: string[];
  outOfScope: string[];
  dependencies: TaskId[];
  baseCommit: string;
  writablePaths: string[];
  acceptanceCriteria: string[];
  verification: string[];
  expectedOutput: string[];
  reportingFormat: "structured" | "markdown" | "json";
  stopConditions: string[];
  escalationConditions: string[];
}

// Worker outcome
export type WorkerOutcome = "PASS" | "ISSUES" | "BLOCKED";

// Assignment record (v2) - worker assignment with contract
export interface Assignment {
  schemaVersion: 1;
  id: string; // AssignmentId
  deliveryId: DeliveryId;
  taskId: TaskId;
  agentId: string;
  sessionId: string;
  role: "lead" | "builder" | "reviewer";
  contract: TaskContract;
  baseState: {
    commit: string;
    worktreePath: string | null;
    branch: string;
  };
  writableScope: string[];
  isolationMethod: "worktree" | "branch" | "directory" | "sequential";
  status: "dispatched" | "running" | "completed" | "failed" | "cancelled" | "blocked";
  outcome: WorkerOutcome | null;
  dispatchPrompt: string;
  contextReferences: string[];
  startedAt: string;
  completedAt: string | null;
  changedFiles: string[];
  artifactPaths: string[];
  checksRun: string[];
  evidenceIds: EvidenceId[];
  assumptions: string[];
  blockers: string[];
  handoffSummary: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// Decision record (v2)
export interface Decision {
  schemaVersion: 1;
  id: string; // DecisionId
  deliveryId: DeliveryId;
  taskId: TaskId | null;
  phase: string;
  summary: string;
  context: string;
  alternatives: string[];
  chosenOption: string;
  rationale: string;
  evidenceReferences: string[];
  status: "active" | "superseded" | "reverted";
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  revision: number;
}

// Recovery record (v2)
export interface Recovery {
  schemaVersion: 1;
  id: string; // RecoveryId
  deliveryId: DeliveryId;
  taskId: TaskId | null;
  failureClass: string;
  symptom: string;
  attempts: RecoveryAttempt[];
  commonAssumption: string;
  diagnosticProbe: {
    description: string;
    command: string[];
    result: string;
  } | null;
  changedApproach: string | null;
  recoveryRound: number;
  maxRecoveryRounds: number;
  cleanupStatus: "pending" | "completed" | "failed";
  finalOutcome: "resolved" | "escalated" | "blocked";
  stopReason: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryAttempt {
  attemptNumber: number;
  description: string;
  observedResult: string;
  assumptionTested: string;
  timestamp: string;
}

// Lesson lifecycle (v2)
export type LessonStatus = "candidate" | "assessed" | "promoted" | "verified" | "closed" | "superseded";

export type PreventionMechanism = 
  | "structure"
  | "types"
  | "lint"
  | "ci"
  | "test"
  | "skill"
  | "memory";

export interface Lesson {
  schemaVersion: 1;
  id: string; // LessonId
  deliveryId: DeliveryId;
  taskId: TaskId | null;
  failureClass: string;
  occurrences: string[]; // evidence/task/evidence IDs
  recurrenceCount: number;
  impactAssessment: "low" | "medium" | "high" | "critical";
  preventionMechanism: PreventionMechanism;
  implementationArtifact: string | null; // commit, file path, config change
  validationResult: "passed" | "failed" | "pending" | "not_tested" | null;
  status: LessonStatus;
  owner: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  supersededBy: string | null;
  revision: number;
}

// Progress checkpoint (v2) - plugin index for PROGRESS.md
export interface Checkpoint {
  schemaVersion: 1;
  id: string; // CheckpointId
  deliveryId: DeliveryId;
  taskId: TaskId | null;
  progressPath: string; // path to PROGRESS.md
  contentHash: string; // SHA256 of PROGRESS.md content
  branch: string;
  commit: string;
  worktreePath: string | null;
  verifiedWork: string[];
  nextAction: string;
  openQuestions: string[];
  blockers: string[];
  keyFacts: Record<string, string>;
  decisions: string[]; // Decision IDs
  failedApproaches: string[];
  verificationStatus: {
    passed: string[];
    failed: string[];
    skipped: string[];
    remaining: string[];
  };
  freshness: "current" | "stale" | "unknown" | "mismatch";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// Repo state for checkpoint revalidation
export interface RepoState {
  branch: string;
  commit: string;
  worktreePath: string | null;
  dirtyFiles: string[];
}

// Project verification skill index (v2)
export interface ProjectVerificationIndex {
  schemaVersion: 1;
  id: string;
  projectPath: string;
  harness: "opencode" | "codex" | "claude-code" | "other";
  skillPath: string;
  contentHash: string;
  version: string;
  surfaceCoverage: string[];
  lastValidated: string;
  validationEvidence: string[];
  status: "current" | "stale" | "missing" | "unknown";
  gaps: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// Extended Event types for v2
export type V2EventType =
  | "workflow_selected"
  | "task_contract_created"
  | "worker_assignment_dispatched"
  | "worker_assignment_completed"
  | "worker_assignment_blocked"
  | "writable_scope_conflict"
  | "evidence_recorded"
  | "review_started"
  | "review_completed"
  | "finding_dispositioned"
  | "decision_created"
  | "decision_superseded"
  | "recovery_started"
  | "recovery_attempt_recorded"
  | "recovery_completed"
  | "recovery_escalated"
  | "checkpoint_created"
  | "checkpoint_revalidated"
  | "checkpoint_stale"
  | "lesson_candidate"
  | "lesson_assessed"
  | "lesson_promoted"
  | "lesson_verified"
  | "lesson_closed"
  | "lesson_superseded"
  | "project_verification_created"
  | "project_verification_updated"
  | "project_verification_validated"
  | "project_verification_stale";

export type EventType = V2EventType | "delivery_created" | "delivery_updated" | "delivery_started" | "delivery_completed" | "delivery_cancelled" | "delivery_failed" | "phase_entered" | "phase_advanced" | "phase_skipped" | "phase_reopened" | "phase_blocked" | "task_created" | "task_assigned" | "task_started" | "task_completed" | "task_blocked" | "task_reopened" | "task_cancelled" | "agent_dispatched" | "agent_completed" | "agent_failed" | "agent_cancelled" | "check_started" | "check_completed" | "check_failed" | "check_timed_out" | "review_started" | "review_completed" | "finding_opened" | "finding_resolved" | "finding_deferred" | "gate_evaluated" | "gate_passed" | "gate_failed" | "approval_requested" | "approval_granted" | "approval_rejected" | "approval_expired" | "release_prepared" | "release_validated" | "release_published" | "deployment_prepared" | "deployment_executed" | "deployment_rolled_back" | "smoke_test_completed" | "post_release_recorded";