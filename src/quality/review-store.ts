/**
 * Review Store
 * 
 * Manages review sessions and findings with independence tracking and dispositions.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs } from "../persistence/file-store.js";
import { ReviewSession, ReviewFinding, ReviewType, ReviewIndependence, FindingSeverity, FindingCategory, FindingDisposition, DeliveryId, TaskId, PhaseRunId, EvidenceId } from "../schemas/types.js";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface ReviewStore {
  createReviewSession(params: CreateReviewSessionParams): Promise<ReviewSession>;
  getReviewSession(reviewSessionId: string): Promise<ReviewSession | null>;
  listReviewSessions(deliveryId: string, filters?: ReviewSessionFilters): Promise<ReviewSession[]>;
  updateReviewSession(reviewSessionId: string, updates: ReviewSessionUpdates): Promise<ReviewSession>;
  addFinding(reviewSessionId: string, finding: Omit<ReviewFinding, "id" | "createdAt" | "updatedAt">): Promise<ReviewFinding>;
  updateFinding(reviewSessionId: string, findingId: string, updates: FindingUpdates): Promise<ReviewFinding>;
  disposeFinding(reviewSessionId: string, findingId: string, disposition: FindingDisposition, rationale: string): Promise<ReviewFinding>;
}

export interface CreateReviewSessionParams {
  deliveryId: string;
  taskId?: TaskId | null;
  phaseRunId?: PhaseRunId | null;
  type: ReviewType;
  independence: ReviewIndependence;
  reviewerId: string;
  reviewerSessionId?: string | null;
  baseCommit: string;
  diffRef?: string | null;
  evidenceConsidered?: EvidenceId[];
}

export interface ReviewSessionFilters {
  status?: ReviewSession["status"][];
  type?: ReviewType[];
  independence?: ReviewIndependence[];
  reviewerId?: string;
}

export interface ReviewSessionUpdates {
  status?: ReviewSession["status"];
  evidenceConsidered?: EvidenceId[];
  completedAt?: string;
  findings?: ReviewFinding[];
}

export interface FindingUpdates {
  severity?: FindingSeverity;
  category?: FindingCategory;
  title?: string;
  description?: string;
  location?: string;
  evidenceRefs?: EvidenceId[];
}

function reviewDir(paths: VstackPaths, deliveryId: string): string {
  return resolve(paths.deliveries, deliveryId, "reviews");
}

function reviewFile(paths: VstackPaths, deliveryId: string, reviewSessionId: string): string {
  return resolve(reviewDir(paths, deliveryId), `${reviewSessionId}.json`);
}

async function findReviewSessionImpl(paths: VstackPaths, reviewSessionId: string): Promise<{ session: ReviewSession; deliveryId: string; path: string } | null> {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "reviews", `${reviewSessionId}.json`);
    const session = await readJsonFile<ReviewSession>(paths, path);
    if (session) return { session, deliveryId: dir, path };
  }
  return null;
}

export async function createReviewStore(paths: VstackPaths): Promise<ReviewStore> {
  return {
    async createReviewSession(params) {
      const id = `rev_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const now = new Date().toISOString();

      const session: ReviewSession = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as any,
        taskId: params.taskId as any,
        phaseRunId: params.phaseRunId as any,
        type: params.type,
        independence: params.independence,
        reviewerId: params.reviewerId,
        reviewerSessionId: params.reviewerSessionId ?? null,
        baseCommit: params.baseCommit,
        diffRef: params.diffRef ?? null,
        evidenceConsidered: params.evidenceConsidered ?? [],
        findings: [],
        status: "in_progress",
        startedAt: now,
        completedAt: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };

      const { mkdirSync } = await import("node:fs");
      const dir = reviewDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });

      await writeJsonFile(paths, reviewFile(paths, params.deliveryId, id), session);
      return session;
    },

    async getReviewSession(reviewSessionId) {
      const found = await findReviewSessionImpl(paths, reviewSessionId);
      return found?.session ?? null;
    },

    async listReviewSessions(deliveryId, filters = {}) {
      const dir = reviewDir(paths, deliveryId);
      if (!require("node:fs").existsSync(dir)) return [];

      const sessionIds = listFiles(paths, dir);
      const sessions: ReviewSession[] = [];

      for (const sessionId of sessionIds) {
        const session = await readJsonFile<ReviewSession>(paths, resolve(dir, `${sessionId}.json`));
        if (!session) continue;

        if (filters.status && !filters.status.includes(session.status)) continue;
        if (filters.type && filters.type.length > 0 && !filters.type.includes(session.type)) continue;
        if (filters.independence && !filters.independence.includes(session.independence)) continue;
        if (filters.reviewerId && session.reviewerId !== filters.reviewerId) continue;

        sessions.push(session);
      }

      sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return sessions;
    },

    async updateReviewSession(reviewSessionId, updates) {
      const found = await findReviewSessionImpl(paths, reviewSessionId);
      if (!found) throw new Error(`Review session ${reviewSessionId} not found`);

      const updated: ReviewSession = {
        ...found.session,
        ...updates,
        updatedAt: new Date().toISOString(),
        revision: found.session.revision + 1,
      };

      await writeJsonFile(paths, found.path, updated);
      return updated;
    },

    async addFinding(reviewSessionId, finding) {
      const found = await findReviewSessionImpl(paths, reviewSessionId);
      if (!found) throw new Error(`Review session ${reviewSessionId} not found`);

      const now = new Date().toISOString();
      const newFinding: ReviewFinding = {
        ...finding,
        id: `fnd_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        createdAt: now,
        updatedAt: now,
      };

      const updated: ReviewSession = {
        ...found.session,
        findings: [...found.session.findings, newFinding],
        updatedAt: now,
        revision: found.session.revision + 1,
      };

      await writeJsonFile(paths, found.path, updated);
      return newFinding;
    },

    async updateFinding(reviewSessionId, findingId, updates) {
      const found = await findReviewSessionImpl(paths, reviewSessionId);
      if (!found) throw new Error(`Review session ${reviewSessionId} not found`);

      const findingIndex = found.session.findings.findIndex(f => f.id === findingId);
      if (findingIndex === -1) throw new Error(`Finding ${findingId} not found`);

      const existingFinding = found.session.findings[findingIndex]!;
      const now = new Date().toISOString();
      const updatedFinding: ReviewFinding = {
        ...existingFinding,
        ...updates,
        id: existingFinding.id,
        severity: updates.severity ?? existingFinding.severity,
        category: updates.category ?? existingFinding.category,
        title: updates.title ?? existingFinding.title,
        description: updates.description ?? existingFinding.description,
        location: updates.location ?? existingFinding.location,
        evidenceRefs: updates.evidenceRefs ?? existingFinding.evidenceRefs,
        disposition: existingFinding.disposition,
        rationale: existingFinding.rationale,
        createdAt: existingFinding.createdAt,
        updatedAt: now,
      };

      const updatedSession: ReviewSession = {
        ...found.session,
        findings: [
          ...found.session.findings.slice(0, findingIndex),
          updatedFinding,
          ...found.session.findings.slice(findingIndex + 1),
        ],
        updatedAt: now,
        revision: found.session.revision + 1,
      };

      await writeJsonFile(paths, found.path, updatedSession);
      return updatedFinding;
    },

    async disposeFinding(reviewSessionId, findingId, disposition, rationale) {
      const found = await findReviewSessionImpl(paths, reviewSessionId);
      if (!found) throw new Error(`Review session ${reviewSessionId} not found`);

      const findingIndex = found.session.findings.findIndex(f => f.id === findingId);
      if (findingIndex === -1) throw new Error(`Finding ${findingId} not found`);

      const existingFinding = found.session.findings[findingIndex]!;
      const now = new Date().toISOString();
      const updatedFinding: ReviewFinding = {
        ...existingFinding,
        disposition,
        rationale,
        id: existingFinding.id,
        severity: existingFinding.severity,
        category: existingFinding.category,
        title: existingFinding.title,
        description: existingFinding.description,
        location: existingFinding.location,
        evidenceRefs: existingFinding.evidenceRefs,
        createdAt: existingFinding.createdAt,
        updatedAt: now,
      };

      const updatedSession: ReviewSession = {
        ...found.session,
        findings: [
          ...found.session.findings.slice(0, findingIndex),
          updatedFinding,
          ...found.session.findings.slice(findingIndex + 1),
        ],
        updatedAt: now,
        revision: found.session.revision + 1,
      };

      await writeJsonFile(paths, found.path, updatedSession);
      return updatedFinding;
    },
  };
}