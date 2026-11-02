/**
 * Recovery Store
 * 
 * Manages bounded recovery records for repeated failure handling.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs } from "../persistence/file-store.js";
import { Recovery, RecoveryAttempt, TaskId } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface RecoveryStore {
  createRecovery(params: CreateRecoveryParams): Promise<Recovery>;
  getRecovery(recoveryId: string): Promise<Recovery | null>;
  listRecoveries(deliveryId: string, filters?: RecoveryFilters): Promise<Recovery[]>;
  updateRecovery(recoveryId: string, updates: RecoveryUpdates): Promise<Recovery>;
  recordAttempt(recoveryId: string, attempt: RecoveryAttempt): Promise<Recovery>;
  setDiagnosticProbe(recoveryId: string, probe: Recovery["diagnosticProbe"]): Promise<Recovery>;
  setChangedApproach(recoveryId: string, approach: string): Promise<Recovery>;
  completeRecovery(recoveryId: string, outcome: Recovery["finalOutcome"], stopReason: string): Promise<Recovery>;
}

export interface CreateRecoveryParams {
  deliveryId: string;
  taskId?: TaskId;
  failureClass: string;
  symptom: string;
  maxRecoveryRounds: number;
}

export interface RecoveryFilters {
  finalOutcome?: Recovery["finalOutcome"];
  taskId?: TaskId;
}

export interface RecoveryUpdates {
  cleanupStatus?: Recovery["cleanupStatus"];
  finalOutcome?: Recovery["finalOutcome"];
  stopReason?: string;
}

const recoveryDir = (paths: VstackPaths, deliveryId: string): string => {
  return resolve(paths.deliveries, deliveryId, "recoveries");
};

const recoveryFile = (paths: VstackPaths, deliveryId: string, recoveryId: string): string => {
  return resolve(recoveryDir(paths, deliveryId), `${recoveryId}.json`);
};

const findRecoveryImplFn = async (paths: VstackPaths, recoveryId: string): Promise<{ recovery: Recovery; deliveryId: string; path: string } | null> => {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "recoveries", `${recoveryId}.json`);
    const recovery = await readJsonFile<Recovery>(paths, path);
    if (recovery) return { recovery, deliveryId: dir, path };
  }
  return null;
};

export async function createRecoveryStore(paths: VstackPaths): Promise<RecoveryStore> {
  return {
    async createRecovery(params) {
      const id = `rec_${uuidv4()}`;
      const now = new Date().toISOString();
      
      const recovery: Recovery = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as any,
        taskId: params.taskId as any,
        failureClass: params.failureClass,
        symptom: params.symptom,
        attempts: [],
        commonAssumption: "",
        diagnosticProbe: null,
        changedApproach: null,
        recoveryRound: 0,
        maxRecoveryRounds: params.maxRecoveryRounds,
        cleanupStatus: "pending",
        finalOutcome: "blocked",
        stopReason: "",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      
      const { mkdirSync } = await import("node:fs");
      const dir = recoveryDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });
      
      await writeJsonFile(paths, recoveryFile(paths, params.deliveryId, id), recovery);
      return recovery;
    },
    
    async getRecovery(recoveryId) {
      const found = await findRecoveryImplFn(paths, recoveryId);
      return found?.recovery ?? null;
    },
    
    async listRecoveries(deliveryId, filters = {}) {
      const dir = recoveryDir(paths, deliveryId);
      if (!require("node:fs").existsSync(dir)) return [];
      
      const recoveryIds = listFiles(paths, dir);
      const recoveries: Recovery[] = [];
      
      for (const recoveryId of recoveryIds) {
        const recovery = await readJsonFile<Recovery>(paths, resolve(dir, `${recoveryId}.json`));
        if (!recovery) continue;
        
        if (filters.finalOutcome && recovery.finalOutcome !== filters.finalOutcome) continue;
        if (filters.taskId && recovery.taskId !== filters.taskId) continue;
        
        recoveries.push(recovery);
      }
      
      recoveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return recoveries;
    },
    
    async updateRecovery(recoveryId, updates) {
      const found = await findRecoveryImplFn(paths, recoveryId);
      if (!found) throw new Error(`Recovery ${recoveryId} not found`);
      
      const updated: Recovery = {
        ...found.recovery,
        ...updates,
        updatedAt: new Date().toISOString(),
        revision: found.recovery.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async recordAttempt(recoveryId, attempt) {
      const found = await findRecoveryImplFn(paths, recoveryId);
      if (!found) throw new Error(`Recovery ${recoveryId} not found`);
      
      const recovery = found.recovery;
      const newAttempt: RecoveryAttempt = {
        ...attempt,
        attemptNumber: recovery.attempts.length + 1,
        timestamp: new Date().toISOString(),
      };
      
      const updated: Recovery = {
        ...recovery,
        attempts: [...recovery.attempts, newAttempt],
        recoveryRound: recovery.recoveryRound + 1,
        updatedAt: new Date().toISOString(),
        revision: recovery.revision + 1,
      };
      
      if (updated.recoveryRound >= updated.maxRecoveryRounds) {
        updated.finalOutcome = "escalated";
        updated.stopReason = "Max recovery rounds exceeded";
        updated.cleanupStatus = "completed";
      }
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async setDiagnosticProbe(recoveryId, probe) {
      const found = await findRecoveryImplFn(paths, recoveryId);
      if (!found) throw new Error(`Recovery ${recoveryId} not found`);
      
      const updated: Recovery = {
        ...found.recovery,
        diagnosticProbe: probe,
        commonAssumption: probe ? `Assumption: ${probe.description}` : found.recovery.commonAssumption,
        updatedAt: new Date().toISOString(),
        revision: found.recovery.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async setChangedApproach(recoveryId, approach) {
      const found = await findRecoveryImplFn(paths, recoveryId);
      if (!found) throw new Error(`Recovery ${recoveryId} not found`);
      
      const updated: Recovery = {
        ...found.recovery,
        changedApproach: approach,
        updatedAt: new Date().toISOString(),
        revision: found.recovery.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async completeRecovery(recoveryId, outcome, stopReason) {
      const found = await findRecoveryImplFn(paths, recoveryId);
      if (!found) throw new Error(`Recovery ${recoveryId} not found`);
      
      const updated: Recovery = {
        ...found.recovery,
        finalOutcome: outcome,
        stopReason,
        cleanupStatus: "completed",
        updatedAt: new Date().toISOString(),
        revision: found.recovery.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
  };
}