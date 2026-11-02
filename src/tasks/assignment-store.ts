/**
 * Assignment Store
 * 
 * Manages worker assignments with task contracts and outcomes.
 * Includes write-scope conflict detection for parallel work safety.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs } from "../persistence/file-store.js";
import { Assignment, TaskContract, WorkerOutcome, TaskId, EvidenceId } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface AssignmentStore {
  createAssignment(params: CreateAssignmentParams): Promise<Assignment>;
  getAssignment(assignmentId: string): Promise<Assignment | null>;
  listAssignments(deliveryId: string, filters?: AssignmentFilters): Promise<Assignment[]>;
  updateAssignment(assignmentId: string, updates: AssignmentUpdates): Promise<Assignment>;
  getAssignmentByTask(taskId: TaskId): Promise<Assignment | null>;
  checkWriteScopeConflict(deliveryId: string, writablePaths: string[], excludeAssignmentId?: string): Promise<WriteScopeConflict[]>;
  validateAssignmentOutcome(assignmentId: string, outcome: WorkerOutcome, evidence: AssignmentEvidence): Promise<boolean>;
}

export interface CreateAssignmentParams {
  deliveryId: string;
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
  dispatchPrompt: string;
  contextReferences: string[];
}

export interface AssignmentFilters {
  status?: Assignment["status"][];
  role?: "lead" | "builder" | "reviewer";
  taskId?: TaskId;
  outcome?: WorkerOutcome;
}

export interface AssignmentUpdates {
  status?: Assignment["status"];
  outcome?: WorkerOutcome;
  completedAt?: string;
  changedFiles?: string[];
  artifactPaths?: string[];
  checksRun?: string[];
  evidenceIds?: EvidenceId[];
  assumptions?: string[];
  blockers?: string[];
  handoffSummary?: string;
}

export interface WriteScopeConflict {
  assignmentId: string;
  taskId: TaskId;
  conflictingPaths: string[];
  severity: "warning" | "error";
  recommendedIsolation: "worktree" | "branch" | "directory" | "sequential";
}

export interface AssignmentEvidence {
  changedFiles: string[];
  artifactPaths: string[];
  checksRun: string[];
  evidenceIds: EvidenceId[];
  blockers: string[];
}

const assignmentDir = (paths: VstackPaths, deliveryId: string): string => {
  return resolve(paths.deliveries, deliveryId, "assignments");
};

const assignmentFile = (paths: VstackPaths, deliveryId: string, assignmentId: string): string => {
  return resolve(assignmentDir(paths, deliveryId), `${assignmentId}.json`);
};

const normalizePaths = (paths: string[]): string[] => {
  return paths.map(p => p.replace(/\\/g, "/").replace(/\/+$/, ""));
};

const pathsOverlap = (paths1: string[], paths2: string[]): string[] => {
  const norm1 = normalizePaths(paths1);
  const norm2 = normalizePaths(paths2);
  const conflicts: string[] = [];
  
  for (const p1 of norm1) {
    for (const p2 of norm2) {
      if (p1 === p2 || p1.startsWith(p2 + "/") || p2.startsWith(p1 + "/")) {
        conflicts.push(p1);
      }
    }
  }
  return conflicts;
};

const findAssignmentImplFn = async (paths: VstackPaths, assignmentId: string): Promise<{ assignment: Assignment; deliveryId: string; path: string } | null> => {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "assignments", `${assignmentId}.json`);
    const assignment = await readJsonFile<Assignment>(paths, path);
    if (assignment) return { assignment, deliveryId: dir, path };
  }
  return null;
};

export async function createAssignmentStore(paths: VstackPaths): Promise<AssignmentStore> {
  const checkWriteScopeConflict = async (
    deliveryId: string,
    writablePaths: string[],
    excludeAssignmentId?: string
  ): Promise<WriteScopeConflict[]> => {
    const dir = assignmentDir(paths, deliveryId);
    if (!require("node:fs").existsSync(dir)) return [];
    
    const assignmentIds = listFiles(paths, dir);
    const conflicts: WriteScopeConflict[] = [];
    const newPaths = normalizePaths(writablePaths);
    
    for (const assignmentId of assignmentIds) {
      if (excludeAssignmentId && assignmentId === excludeAssignmentId) continue;
      
      const assignment = await readJsonFile<Assignment>(paths, resolve(dir, `${assignmentId}.json`));
      if (!assignment) continue;
      if (assignment.status !== "dispatched" && assignment.status !== "running") continue;
      
      const existingPaths = normalizePaths(assignment.writableScope);
      const overlapping = pathsOverlap(newPaths, existingPaths);
      
      if (overlapping.length > 0) {
        const severity = assignment.isolationMethod === "worktree" ? "warning" : "error";
        conflicts.push({
          assignmentId: assignment.id,
          taskId: assignment.taskId,
          conflictingPaths: overlapping,
          severity,
          recommendedIsolation: severity === "error" ? "worktree" : assignment.isolationMethod,
        });
      }
    }
    
    return conflicts;
  };

  const listAssignmentsImpl = async (
    deliveryId: string,
    filters?: AssignmentFilters
  ): Promise<Assignment[]> => {
    const dir = assignmentDir(paths, deliveryId);
    if (!require("node:fs").existsSync(dir)) return [];
    
    const assignmentIds = listFiles(paths, dir);
    const assignments: Assignment[] = [];
    
    for (const assignmentId of assignmentIds) {
      const assignment = await readJsonFile<Assignment>(paths, resolve(dir, `${assignmentId}.json`));
      if (!assignment) continue;
      
      if (filters?.status && !filters.status.includes(assignment.status)) continue;
      if (filters?.role && assignment.role !== filters.role) continue;
      if (filters?.taskId && assignment.taskId !== filters.taskId) continue;
      if (filters?.outcome && assignment.outcome !== filters.outcome) continue;
      
      assignments.push(assignment);
    }
    
    assignments.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return assignments;
  };

  const getAssignmentByTask = async (taskId: TaskId): Promise<Assignment | null> => {
    const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
    for (const dir of deliveryDirs) {
      const assignments = await listAssignmentsImpl(dir);
      const found = assignments.find(a => a.taskId === taskId);
      if (found) return found;
    }
    return null;
  };

  const validateAssignmentOutcome = async (
    assignmentId: string,
    outcome: WorkerOutcome,
    evidence: AssignmentEvidence
  ): Promise<boolean> => {
    const found = await findAssignmentImplFn(paths, assignmentId);
    if (!found) throw new Error(`Assignment ${assignmentId} not found`);
    
    if (!["PASS", "ISSUES", "BLOCKED"].includes(outcome)) {
      throw new Error(`Invalid outcome: ${outcome}. Must be PASS, ISSUES, or BLOCKED`);
    }
    
    const assignment = found.assignment;
    
    if (outcome === "PASS") {
      const contract = assignment.contract;
      for (const criterion of contract.acceptanceCriteria) {
        if (evidence.evidenceIds.length === 0 && contract.acceptanceCriteria.length > 0) {
          return false;
        }
      }
    }
    
    if (outcome !== "PASS" && evidence.blockers.length === 0 && assignment.blockers.length === 0) {
      return false;
    }
    
    return true;
  };

  return {
    async createAssignment(params) {
      const id = `asg_${uuidv4()}`;
      const now = new Date().toISOString();
      
      const conflicts = await checkWriteScopeConflict(params.deliveryId, params.writableScope);
      const hasErrors = conflicts.some(c => c.severity === "error");
      if (hasErrors) {
        throw new Error(`Write scope conflicts detected: ${conflicts.filter(c => c.severity === "error").map(c => c.conflictingPaths.join(", ")).join("; ")}`);
      }
      
      const assignment: Assignment = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as any,
        taskId: params.taskId as any,
        agentId: params.agentId,
        sessionId: params.sessionId,
        role: params.role,
        contract: params.contract,
        baseState: params.baseState,
        writableScope: params.writableScope,
        isolationMethod: params.isolationMethod,
        status: "dispatched",
        outcome: null,
        dispatchPrompt: params.dispatchPrompt,
        contextReferences: params.contextReferences,
        startedAt: now,
        completedAt: null,
        changedFiles: [],
        artifactPaths: [],
        checksRun: [],
        evidenceIds: [],
        assumptions: [],
        blockers: [],
        handoffSummary: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      
      const { mkdirSync } = await import("node:fs");
      const dir = assignmentDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });
      
      await writeJsonFile(paths, assignmentFile(paths, params.deliveryId, id), assignment);
      return assignment;
    },
    
    async getAssignment(assignmentId) {
      const found = await findAssignmentImplFn(paths, assignmentId);
      return found?.assignment ?? null;
    },
    
    async listAssignments(deliveryId, filters = {}) {
      return listAssignmentsImpl(deliveryId, filters);
    },
    
    async updateAssignment(assignmentId, updates) {
      const found = await findAssignmentImplFn(paths, assignmentId);
      if (!found) throw new Error(`Assignment ${assignmentId} not found`);
      
      const updated: Assignment = {
        ...found.assignment,
        ...updates,
        evidenceIds: updates.evidenceIds ? updates.evidenceIds.map(e => e as any) : found.assignment.evidenceIds,
        updatedAt: new Date().toISOString(),
        revision: found.assignment.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    getAssignmentByTask,
    checkWriteScopeConflict,
    validateAssignmentOutcome,
  };
}