/**
 * Decision Store
 * 
 * Manages concise engineering decision records for significant choices and pivots.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs } from "../persistence/file-store.js";
import { Decision, DeliveryId, TaskId } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface DecisionStore {
  createDecision(params: CreateDecisionParams): Promise<Decision>;
  getDecision(decisionId: string): Promise<Decision | null>;
  listDecisions(deliveryId: string, filters?: DecisionFilters): Promise<Decision[]>;
  updateDecision(decisionId: string, updates: DecisionUpdates): Promise<Decision>;
  supersedeDecision(decisionId: string, newDecisionId: string): Promise<void>;
}

export interface CreateDecisionParams {
  deliveryId: string;
  taskId?: TaskId;
  phase: string;
  summary: string;
  context: string;
  alternatives: string[];
  chosenOption: string;
  rationale: string;
  evidenceReferences: string[];
  createdBy: string;
}

export interface DecisionFilters {
  status?: Decision["status"][];
  phase?: string;
  taskId?: TaskId;
}

export interface DecisionUpdates {
  status?: Decision["status"];
  rationale?: string;
  evidenceReferences?: string[];
  supersededBy?: string;
}

function decisionDir(paths: VstackPaths, deliveryId: string): string {
  return resolve(paths.deliveries, deliveryId, "decisions");
}

function decisionFile(paths: VstackPaths, deliveryId: string, decisionId: string): string {
  return resolve(decisionDir(paths, deliveryId), `${decisionId}.json`);
}

async function findDecisionImpl(paths: VstackPaths, decisionId: string): Promise<{ decision: Decision; deliveryId: string; path: string } | null> {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "decisions", `${decisionId}.json`);
    const decision = await readJsonFile<Decision>(paths, path);
    if (decision) return { decision, deliveryId: dir, path };
  }
  return null;
}

export async function createDecisionStore(paths: VstackPaths): Promise<DecisionStore> {
  return {
    async createDecision(params) {
      const id = `dec_${uuidv4()}`;
      const now = new Date().toISOString();
      
      const decision: Decision = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as any,
        taskId: params.taskId as any,
        phase: params.phase,
        summary: params.summary,
        context: params.context,
        alternatives: params.alternatives,
        chosenOption: params.chosenOption,
        rationale: params.rationale,
        evidenceReferences: params.evidenceReferences,
        status: "active",
        supersededBy: null,
        createdAt: now,
        updatedAt: now,
        createdBy: params.createdBy,
        revision: 1,
      };
      
      const { mkdirSync } = await import("node:fs");
      const dir = decisionDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });
      
      await writeJsonFile(paths, decisionFile(paths, params.deliveryId, id), decision);
      return decision;
    },
    
    async getDecision(decisionId) {
      const found = await findDecisionImpl(paths, decisionId);
      return found?.decision ?? null;
    },
    
    async listDecisions(deliveryId, filters = {}) {
      const dir = decisionDir(paths, deliveryId);
      if (!require("node:fs").existsSync(dir)) return [];
      
      const decisionIds = listFiles(paths, dir);
      const decisions: Decision[] = [];
      
      for (const decisionId of decisionIds) {
        const decision = await readJsonFile<Decision>(paths, resolve(dir, `${decisionId}.json`));
        if (!decision) continue;
        
        if (filters.status && !filters.status.includes(decision.status)) continue;
        if (filters.phase && decision.phase !== filters.phase) continue;
        if (filters.taskId && decision.taskId !== filters.taskId) continue;
        
        decisions.push(decision);
      }
      
      decisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return decisions;
    },
    
    async updateDecision(decisionId, updates) {
      const found = await findDecisionImpl(paths, decisionId);
      if (!found) throw new Error(`Decision ${decisionId} not found`);
      
      const updated: Decision = {
        ...found.decision,
        ...updates,
        updatedAt: new Date().toISOString(),
        revision: found.decision.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async supersedeDecision(decisionId, newDecisionId) {
      const found = await findDecisionImpl(paths, decisionId);
      if (!found) throw new Error(`Decision ${decisionId} not found`);
      
      const updated: Decision = {
        ...found.decision,
        status: "superseded",
        supersededBy: newDecisionId,
        updatedAt: new Date().toISOString(),
        revision: found.decision.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
    },
  };
}