/**
 * Checkpoint Store
 * 
 * Manages progress checkpoint indexes (PROGRESS.md integration).
 * Single canonical checkpoint artifact with plugin index/reference.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs, fileExists, readFile, writeFile } from "../persistence/file-store.js";
import { Checkpoint, DeliveryId, TaskId, RepoState } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";

export interface CheckpointStore {
  createCheckpoint(params: CreateCheckpointParams): Promise<Checkpoint>;
  getCheckpoint(checkpointId: string): Promise<Checkpoint | null>;
  listCheckpoints(deliveryId: string): Promise<Checkpoint[]>;
  updateCheckpoint(checkpointId: string, updates: CheckpointUpdates): Promise<Checkpoint>;
  revalidateCheckpoint(checkpointId: string, currentRepoState: RepoState): Promise<Checkpoint>;
  getLatestCheckpoint(deliveryId: string): Promise<Checkpoint | null>;
}

export interface CreateCheckpointParams {
  deliveryId: string;
  taskId?: TaskId;
  progressPath: string;
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
  verificationStatus: Checkpoint["verificationStatus"];
}

export interface CheckpointUpdates {
  verifiedWork?: string[];
  nextAction?: string;
  openQuestions?: string[];
  blockers?: string[];
  keyFacts?: Record<string, string>;
  decisions?: string[];
  failedApproaches?: string[];
  verificationStatus?: Checkpoint["verificationStatus"];
  freshness?: Checkpoint["freshness"];
}

const checkpointDir = (paths: VstackPaths, deliveryId: string): string => {
  return resolve(paths.deliveries, deliveryId, "checkpoints");
};

const checkpointFile = (paths: VstackPaths, deliveryId: string, checkpointId: string): string => {
  return resolve(checkpointDir(paths, deliveryId), `${checkpointId}.json`);
};

const findCheckpointImplFn = async (paths: VstackPaths, checkpointId: string): Promise<{ checkpoint: Checkpoint; deliveryId: string; path: string } | null> => {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "checkpoints", `${checkpointId}.json`);
    const checkpoint = await readJsonFile<Checkpoint>(paths, path);
    if (checkpoint) return { checkpoint, deliveryId: dir, path };
  }
  return null;
};

const computeHash = (content: string): string => {
  return createHash("sha256").update(content).digest("hex");
};

export async function createCheckpointStore(paths: VstackPaths): Promise<CheckpointStore> {
  const listCheckpointsImpl = async (deliveryId: string): Promise<Checkpoint[]> => {
    const dir = checkpointDir(paths, deliveryId);
    if (!require("node:fs").existsSync(dir)) return [];
    
    const checkpointIds = listFiles(paths, dir);
    const checkpoints: Checkpoint[] = [];
    
    for (const checkpointId of checkpointIds) {
      const checkpoint = await readJsonFile<Checkpoint>(paths, resolve(dir, `${checkpointId}.json`));
      if (!checkpoint) continue;
      checkpoints.push(checkpoint);
    }
    
    checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return checkpoints;
  };

  return {
    async createCheckpoint(params) {
      const id = `chk_${uuidv4()}`;
      const now = new Date().toISOString();
      
      // Read PROGRESS.md content and compute hash
      let contentHash = "";
      try {
        const content = await readFile(paths, params.progressPath);
        if (content !== null) {
          contentHash = computeHash(content);
        } else {
          contentHash = "unreadable";
        }
      } catch {
        contentHash = "unreadable";
      }
      
      const checkpoint: Checkpoint = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as any,
        taskId: params.taskId as any,
        progressPath: params.progressPath,
        contentHash,
        branch: params.branch,
        commit: params.commit,
        worktreePath: params.worktreePath,
        verifiedWork: params.verifiedWork,
        nextAction: params.nextAction,
        openQuestions: params.openQuestions,
        blockers: params.blockers,
        keyFacts: params.keyFacts,
        decisions: params.decisions,
        failedApproaches: params.failedApproaches,
        verificationStatus: params.verificationStatus,
        freshness: "current",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      
      const { mkdirSync } = await import("node:fs");
      const dir = checkpointDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });
      
      await writeJsonFile(paths, checkpointFile(paths, params.deliveryId, id), checkpoint);
      return checkpoint;
    },
    
    async getCheckpoint(checkpointId) {
      const found = await findCheckpointImplFn(paths, checkpointId);
      return found?.checkpoint ?? null;
    },
    
    async listCheckpoints(deliveryId) {
      return listCheckpointsImpl(deliveryId);
    },
    
    async updateCheckpoint(checkpointId, updates) {
      const found = await findCheckpointImplFn(paths, checkpointId);
      if (!found) throw new Error(`Checkpoint ${checkpointId} not found`);
      
      // Update content hash if PROGRESS.md changed
      let contentHash = found.checkpoint.contentHash;
      if (updates.verifiedWork || updates.nextAction || updates.openQuestions || updates.blockers) {
        try {
          const content = await readFile(paths, found.checkpoint.progressPath);
          if (content !== null) {
            contentHash = computeHash(content);
          }
        } catch {
          contentHash = "unreadable";
        }
      }
      
      const updated: Checkpoint = {
        ...found.checkpoint,
        ...updates,
        contentHash,
        updatedAt: new Date().toISOString(),
        revision: found.checkpoint.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async revalidateCheckpoint(checkpointId, currentRepoState) {
      const found = await findCheckpointImplFn(paths, checkpointId);
      if (!found) throw new Error(`Checkpoint ${checkpointId} not found`);
      
      const checkpoint = found.checkpoint;
      let freshness: Checkpoint["freshness"] = "current";
      const mismatches: string[] = [];
      
      // Check branch
      if (checkpoint.branch !== currentRepoState.branch) {
        freshness = "mismatch";
        mismatches.push(`branch: checkpoint=${checkpoint.branch} vs current=${currentRepoState.branch}`);
      }
      
      // Check commit
      if (checkpoint.commit !== currentRepoState.commit) {
        freshness = "mismatch";
        mismatches.push(`commit: checkpoint=${checkpoint.commit} vs current=${currentRepoState.commit}`);
      }
      
      // Check worktree
      if (checkpoint.worktreePath !== currentRepoState.worktreePath) {
        if (freshness === "current") freshness = "stale";
        mismatches.push(`worktree: checkpoint=${checkpoint.worktreePath} vs current=${currentRepoState.worktreePath}`);
      }
      
      // Check PROGRESS.md content hash
      try {
        const content = await readFile(paths, checkpoint.progressPath);
        if (content !== null) {
          const currentHash = createHash("sha256").update(content).digest("hex");
          if (checkpoint.contentHash !== currentHash && checkpoint.contentHash !== "unreadable") {
            freshness = "stale";
            mismatches.push("PROGRESS.md content changed");
          }
        }
      } catch {
        if (freshness === "current") freshness = "stale";
        mismatches.push("PROGRESS.md unreadable");
      }
      
      const updated: Checkpoint = {
        ...checkpoint,
        freshness,
        updatedAt: new Date().toISOString(),
        revision: checkpoint.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async getLatestCheckpoint(deliveryId) {
      const checkpoints = await listCheckpointsImpl(deliveryId);
      return checkpoints[0] ?? null;
    },
  };
}