/**
 * Session Pickup Utility
 * 
 * Validates repository state against checkpoints and runtime state
 * for safe session resumption.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { CheckpointStore } from "../tasks/checkpoint-store.js";
import { TaskStore } from "../tasks/task-store.js";
import { DeliveryStore } from "../deliveries/delivery-store.js";
import { AgentRunStore } from "../agents/agent-run-store.js";
import { EvidenceLedger } from "../quality/evidence-ledger.js";
import { HistoryService } from "../history/history-service.js";
import { Checkpoint, Task, Delivery, AgentRun, Evidence, RepoState } from "../schemas/types.js";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

export interface SessionPickupResult {
  success: boolean;
  checkpoint: Checkpoint | null;
  repoState: RepoState;
  discrepancies: Discrepancy[];
  validatedTasks: ValidatedTask[];
  staleEvidence: string[];
  nextAction: string | null;
  canResume: boolean;
  warnings: string[];
}

export interface Discrepancy {
  type: "branch" | "commit" | "worktree" | "checkpoint_content" | "task_status" | "evidence_stale";
  severity: "error" | "warning" | "info";
  description: string;
  checkpointValue?: string;
  currentValue?: string;
}

export interface ValidatedTask {
  taskId: string;
  title: string;
  claimedStatus: string;
  validatedStatus: string;
  hasEvidence: boolean;
  evidenceIds: string[];
  discrepancy: boolean;
}

export async function performSessionPickup(
  paths: VstackPaths,
  deliveryId: string,
  checkpointStore: CheckpointStore,
  taskStore: TaskStore,
  deliveryStore: DeliveryStore,
  agentRunStore: AgentRunStore,
  evidenceStore: EvidenceLedger,
  historyService: HistoryService
): Promise<SessionPickupResult> {
  const warnings: string[] = [];
  const discrepancies: Discrepancy[] = [];
  
  // 1. Get current repository state
  const repoState = await getRepoState(paths);
  
  // 2. Get latest checkpoint
  const checkpoint = await checkpointStore.getLatestCheckpoint(deliveryId);
  
  if (!checkpoint) {
    return {
      success: false,
      checkpoint: null,
      repoState,
      discrepancies: [{
        type: "checkpoint_content",
        severity: "error",
        description: "No checkpoint found for delivery",
      }],
      validatedTasks: [],
      staleEvidence: [],
      nextAction: null,
      canResume: false,
      warnings: ["No checkpoint found - cannot safely resume"],
    };
  }
  
  // 3. Revalidate checkpoint against current repo state
  const revalidatedCheckpoint = await checkpointStore.revalidateCheckpoint(
    checkpoint.id,
    repoState
  );
  
  // Collect discrepancies from revalidation
  if (revalidatedCheckpoint.freshness !== "current") {
    for (const mismatch of getMismatches(checkpoint, revalidatedCheckpoint, repoState)) {
      discrepancies.push(mismatch);
    }
  }
  
  // 4. Validate tasks against checkpoint claims
  const validatedTasks = await validateTasksAgainstCheckpoint(
    paths,
    deliveryId,
    checkpoint,
    taskStore,
    evidenceStore
  );
  
  // 5. Check for stale evidence
  const staleEvidence = await findStaleEvidence(
    paths,
    deliveryId,
    checkpoint,
    evidenceStore,
    repoState
  );
  
  // 6. Check for interrupted agent runs
  const interruptedRuns = await checkInterruptedAgentRuns(
    deliveryId,
    agentRunStore
  );
  
  for (const run of interruptedRuns) {
    discrepancies.push({
      type: "task_status",
      severity: "warning",
      description: `Agent run ${run.id} was interrupted (status: ${run.status})`,
      checkpointValue: run.status,
      currentValue: "unknown",
    });
    warnings.push(`Agent run ${run.id} may have incomplete work`);
  }
  
  // 7. Determine if safe to resume
  const hasErrors = discrepancies.some(d => d.severity === "error");
  const canResume = !hasErrors && validatedTasks.every(t => !t.discrepancy);
  
  // 8. Get next action from checkpoint
  const nextAction = revalidatedCheckpoint.nextAction;
  
  return {
    success: true,
    checkpoint: revalidatedCheckpoint,
    repoState,
    discrepancies,
    validatedTasks,
    staleEvidence,
    nextAction,
    canResume,
    warnings,
  };
}

function getMismatches(
  original: Checkpoint,
  revalidated: Checkpoint,
  repoState: RepoState
): Discrepancy[] {
  const mismatches: Discrepancy[] = [];
  
  if (original.branch !== repoState.branch) {
    mismatches.push({
      type: "branch",
      severity: "error",
      description: `Branch mismatch: checkpoint=${original.branch} vs current=${repoState.branch}`,
      checkpointValue: original.branch,
      currentValue: repoState.branch,
    });
  }
  
  if (original.commit !== repoState.commit) {
    mismatches.push({
      type: "commit",
      severity: "error",
      description: `Commit mismatch: checkpoint=${original.commit.slice(0, 8)} vs current=${repoState.commit.slice(0, 8)}`,
      checkpointValue: original.commit.slice(0, 8),
      currentValue: repoState.commit.slice(0, 8),
    });
  }
  
  if (original.worktreePath !== repoState.worktreePath) {
    mismatches.push({
      type: "worktree",
      severity: "warning",
      description: `Worktree changed: checkpoint=${original.worktreePath || "main"} vs current=${repoState.worktreePath || "main"}`,
      checkpointValue: original.worktreePath || "main",
      currentValue: repoState.worktreePath || "main",
    });
  }
  
  if (original.contentHash !== revalidated.contentHash && original.contentHash !== "unreadable") {
    mismatches.push({
      type: "checkpoint_content",
      severity: "warning",
      description: "PROGRESS.md content has changed since checkpoint",
      checkpointValue: original.contentHash.slice(0, 16),
      currentValue: revalidated.contentHash.slice(0, 16),
    });
  }
  
  return mismatches;
}

async function validateTasksAgainstCheckpoint(
  paths: VstackPaths,
  deliveryId: string,
  checkpoint: Checkpoint,
  taskStore: TaskStore,
  evidenceStore: EvidenceLedger
): Promise<ValidatedTask[]> {
  const tasks = await taskStore.listTasks(deliveryId);
  const validated: ValidatedTask[] = [];
  
  for (const task of tasks) {
    const checkpointVerified = checkpoint.verifiedWork.includes(task.id);
    const hasEvidence = task.evidenceIds && task.evidenceIds.length > 0;
    
    // Check if evidence is still valid (commit matches)
    let evidenceStale = false;
    if (hasEvidence) {
      for (const evidenceId of task.evidenceIds || []) {
        const evidence = await evidenceStore.get(deliveryId, evidenceId);
        if (evidence && evidence.commitRef !== checkpoint.commit) {
          evidenceStale = true;
          break;
        }
      }
    }
    
    const discrepancy = checkpointVerified && (!hasEvidence || evidenceStale);
    
    validated.push({
      taskId: task.id,
      title: task.title,
      claimedStatus: task.status,
      validatedStatus: discrepancy ? "needs_revalidation" : task.status,
      hasEvidence,
      evidenceIds: task.evidenceIds || [],
      discrepancy,
    });
  }
  
  return validated;
}

async function findStaleEvidence(
  paths: VstackPaths,
  deliveryId: string,
  checkpoint: Checkpoint,
  evidenceStore: EvidenceLedger,
  repoState: RepoState
): Promise<string[]> {
  // This would check all evidence for the delivery against the checkpoint commit
  // For now, return empty array - full implementation would query evidence store
  return [];
}

async function checkInterruptedAgentRuns(
  deliveryId: string,
  agentRunStore: AgentRunStore
): Promise<AgentRun[]> {
  const runs = await agentRunStore.listAgentRuns(deliveryId, {
    status: ["dispatched", "running"],
  });
  
  return runs.filter(run => run.status === "dispatched" || run.status === "running");
}

async function getRepoState(paths: VstackPaths): Promise<RepoState> {
  try {
    const { execSync } = await import("node:child_process");
    const repoRoot = paths.root;
    
    // Get current branch
    let branch = "unknown";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { 
        cwd: repoRoot, 
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
    } catch {
      branch = "unknown";
    }
    
    // Get current commit
    let commit = "unknown";
    try {
      commit = execSync("git rev-parse HEAD", { 
        cwd: repoRoot, 
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
    } catch {
      commit = "unknown";
    }
    
    // Get worktree path
    let worktreePath: string | null = null;
    try {
      const gitDir = execSync("git rev-parse --git-dir", { 
        cwd: repoRoot, 
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      if (gitDir !== ".git") {
        worktreePath = gitDir.replace("/.git", "");
      }
    } catch {
      // ignore
    }
    
    // Get dirty files
    let dirtyFiles: string[] = [];
    try {
      const status = execSync("git status --porcelain", { 
        cwd: repoRoot, 
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      if (status) {
        dirtyFiles = status.split("\n").map(line => line.slice(3).trim());
      }
    } catch {
      // ignore
    }
    
    return {
      branch,
      commit,
      worktreePath,
      dirtyFiles,
    };
  } catch {
    return {
      branch: "unknown",
      commit: "unknown",
      worktreePath: null,
      dirtyFiles: [],
    };
  }
}