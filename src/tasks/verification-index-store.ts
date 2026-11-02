/**
 * Project Verification Index Store
 * 
 * Indexes project-local verification skills without duplicating content.
 * Tracks freshness via content hash and validation timestamps.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs } from "../persistence/file-store.js";
import { ProjectVerificationIndex } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "node:crypto";

export interface ProjectVerificationStore {
  createIndex(params: CreateIndexParams): Promise<ProjectVerificationIndex>;
  getIndex(indexId: string): Promise<ProjectVerificationIndex | null>;
  listIndexes(deliveryId: string): Promise<ProjectVerificationIndex[]>;
  updateIndex(indexId: string, updates: IndexUpdates): Promise<ProjectVerificationIndex>;
  validateFreshness(indexId: string): Promise<ProjectVerificationIndex>;
  getIndexByPath(skillPath: string): Promise<ProjectVerificationIndex | null>;
}

export interface CreateIndexParams {
  deliveryId: string;
  projectPath: string;
  harness: "opencode" | "codex" | "claude-code" | "other";
  skillPath: string;
  version: string;
  surfaceCoverage: string[];
  gaps: string[];
}

export interface IndexUpdates {
  contentHash?: string;
  version?: string;
  surfaceCoverage?: string[];
  lastValidated?: string;
  validationEvidence?: string[];
  status?: ProjectVerificationIndex["status"];
  gaps?: string[];
}

const verificationDir = (paths: VstackPaths, deliveryId: string): string => {
  return resolve(paths.deliveries, deliveryId, "verification");
};

const verificationFile = (paths: VstackPaths, deliveryId: string, indexId: string): string => {
  return resolve(verificationDir(paths, deliveryId), `${indexId}.json`);
};

const findIndexImplFn = async (paths: VstackPaths, indexId: string): Promise<{ index: ProjectVerificationIndex; deliveryId: string; path: string } | null> => {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "verification", `${indexId}.json`);
    const index = await readJsonFile<ProjectVerificationIndex>(paths, path);
    if (index) return { index, deliveryId: dir, path };
  }
  return null;
};

export async function createProjectVerificationStore(paths: VstackPaths): Promise<ProjectVerificationStore> {
  const listIndexesImpl = async (deliveryId: string): Promise<ProjectVerificationIndex[]> => {
    const dir = verificationDir(paths, deliveryId);
    if (!require("node:fs").existsSync(dir)) return [];
    
    const indexIds = listFiles(paths, dir);
    const indexes: ProjectVerificationIndex[] = [];
    
    for (const indexId of indexIds) {
      const index = await readJsonFile<ProjectVerificationIndex>(paths, resolve(dir, `${indexId}.json`));
      if (!index) continue;
      indexes.push(index);
    }
    
    indexes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return indexes;
  };

  return {
    async createIndex(params) {
      const id = `ver_${uuidv4()}`;
      const now = new Date().toISOString();
      
      let contentHash = "uncomputed";
      try {
        const { readFileSync } = await import("node:fs");
        const content = readFileSync(params.skillPath, "utf-8");
        contentHash = createHash("sha256").update(content).digest("hex");
      } catch {
        contentHash = "unreadable";
      }
      
      const index: ProjectVerificationIndex = {
        schemaVersion: 1,
        id,
        projectPath: params.projectPath,
        harness: params.harness,
        skillPath: params.skillPath,
        contentHash,
        version: params.version,
        surfaceCoverage: params.surfaceCoverage,
        lastValidated: now,
        validationEvidence: [],
        status: "current",
        gaps: params.gaps,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      
      const { mkdirSync } = await import("node:fs");
      const dir = verificationDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });
      
      await writeJsonFile(paths, verificationFile(paths, params.deliveryId, id), index);
      return index;
    },
    
    async getIndex(indexId) {
      const found = await findIndexImplFn(paths, indexId);
      return found?.index ?? null;
    },
    
    async listIndexes(deliveryId) {
      return listIndexesImpl(deliveryId);
    },
    
    async updateIndex(indexId, updates) {
      const found = await findIndexImplFn(paths, indexId);
      if (!found) throw new Error(`Verification index ${indexId} not found`);
      
      const updated: ProjectVerificationIndex = {
        ...found.index,
        ...updates,
        updatedAt: new Date().toISOString(),
        revision: found.index.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async validateFreshness(indexId) {
      const found = await findIndexImplFn(paths, indexId);
      if (!found) throw new Error(`Verification index ${indexId} not found`);
      
      const index = found.index;
      let status: ProjectVerificationIndex["status"] = "current";
      const gaps: string[] = [...index.gaps];
      
      const { existsSync, readFileSync } = await import("node:fs");
      if (!existsSync(index.skillPath)) {
        status = "missing";
        gaps.push("Skill file missing");
      } else {
        try {
          const content = readFileSync(index.skillPath, "utf-8");
          const currentHash = createHash("sha256").update(content).digest("hex");
          if (index.contentHash !== currentHash && index.contentHash !== "uncomputed" && index.contentHash !== "unreadable") {
            status = "stale";
            gaps.push("Skill content changed since last validation");
          }
        } catch {
          if (status === "current") status = "unknown";
          gaps.push("Skill file unreadable");
        }
      }
      
      const lastValidated = new Date(index.lastValidated);
      const daysSinceValidation = (Date.now() - lastValidated.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceValidation > 30 && status === "current") {
        status = "stale";
        gaps.push(`Validation older than 30 days (${Math.floor(daysSinceValidation)} days)`);
      }
      
      const updated: ProjectVerificationIndex = {
        ...index,
        status,
        gaps,
        updatedAt: new Date().toISOString(),
        revision: index.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async getIndexByPath(skillPath) {
      const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
      for (const dir of deliveryDirs) {
        const indexes = await listIndexesImpl(dir);
        const found = indexes.find(i => i.skillPath === skillPath);
        if (found) return found;
      }
      return null;
    },
  };
}