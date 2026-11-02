/**
 * Lesson Store
 * 
 * Manages lesson lifecycle: Candidate → Assessed → Promoted → Verified → Closed/Superseded
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs } from "../persistence/file-store.js";
import { Lesson, LessonStatus, PreventionMechanism, TaskId } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface LessonStore {
  createLesson(params: CreateLessonParams): Promise<Lesson>;
  getLesson(lessonId: string): Promise<Lesson | null>;
  listLessons(deliveryId: string, filters?: LessonFilters): Promise<Lesson[]>;
  updateLesson(lessonId: string, updates: LessonUpdates): Promise<Lesson>;
  promoteLesson(lessonId: string, mechanism: PreventionMechanism, artifact: string): Promise<Lesson>;
  verifyLesson(lessonId: string, validationResult: "passed" | "failed"): Promise<Lesson>;
  closeLesson(lessonId: string, reason: string): Promise<Lesson>;
}

export interface CreateLessonParams {
  deliveryId: string;
  taskId?: TaskId;
  failureClass: string;
  occurrences: string[];
  recurrenceCount: number;
  impactAssessment: "low" | "medium" | "high" | "critical";
  owner: string;
}

export interface LessonFilters {
  status?: LessonStatus[];
  failureClass?: string;
  taskId?: TaskId;
}

export interface LessonUpdates {
  status?: LessonStatus;
  preventionMechanism?: PreventionMechanism;
  implementationArtifact?: string;
  validationResult?: "passed" | "failed" | "pending" | "not_tested";
  impactAssessment?: "low" | "medium" | "high" | "critical";
}

const lessonDir = (paths: VstackPaths, deliveryId: string): string => {
  return resolve(paths.deliveries, deliveryId, "lessons");
};

const lessonFile = (paths: VstackPaths, deliveryId: string, lessonId: string): string => {
  return resolve(lessonDir(paths, deliveryId), `${lessonId}.json`);
};

const findLessonImplFn = async (paths: VstackPaths, lessonId: string): Promise<{ lesson: Lesson; deliveryId: string; path: string } | null> => {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const path = resolve(paths.deliveries, dir, "lessons", `${lessonId}.json`);
    const lesson = await readJsonFile<Lesson>(paths, path);
    if (lesson) return { lesson, deliveryId: dir, path };
  }
  return null;
};

export async function createLessonStore(paths: VstackPaths): Promise<LessonStore> {
  return {
    async createLesson(params) {
      const id = `lsn_${uuidv4()}`;
      const now = new Date().toISOString();
      
      const lesson: Lesson = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as any,
        taskId: params.taskId as any,
        failureClass: params.failureClass,
        occurrences: params.occurrences,
        recurrenceCount: params.recurrenceCount,
        impactAssessment: params.impactAssessment,
        preventionMechanism: "memory",
        implementationArtifact: null,
        validationResult: null,
        status: "candidate",
        owner: params.owner,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        supersededBy: null,
        revision: 1,
      };
      
      const { mkdirSync } = await import("node:fs");
      const dir = lessonDir(paths, params.deliveryId);
      mkdirSync(dir, { recursive: true });
      
      await writeJsonFile(paths, lessonFile(paths, params.deliveryId, id), lesson);
      return lesson;
    },
    
    async getLesson(lessonId) {
      const found = await findLessonImplFn(paths, lessonId);
      return found?.lesson ?? null;
    },
    
    async listLessons(deliveryId, filters = {}) {
      const dir = lessonDir(paths, deliveryId);
      if (!require("node:fs").existsSync(dir)) return [];
      
      const lessonIds = listFiles(paths, dir);
      const lessons: Lesson[] = [];
      
      for (const lessonId of lessonIds) {
        const lesson = await readJsonFile<Lesson>(paths, resolve(dir, `${lessonId}.json`));
        if (!lesson) continue;
        
        if (filters.status && !filters.status.includes(lesson.status)) continue;
        if (filters.failureClass && lesson.failureClass !== filters.failureClass) continue;
        if (filters.taskId && lesson.taskId !== filters.taskId) continue;
        
        lessons.push(lesson);
      }
      
      lessons.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return lessons;
    },
    
    async updateLesson(lessonId, updates) {
      const found = await findLessonImplFn(paths, lessonId);
      if (!found) throw new Error(`Lesson ${lessonId} not found`);
      
      const updated: Lesson = {
        ...found.lesson,
        ...updates,
        updatedAt: new Date().toISOString(),
        revision: found.lesson.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async promoteLesson(lessonId, mechanism, artifact) {
      const found = await findLessonImplFn(paths, lessonId);
      if (!found) throw new Error(`Lesson ${lessonId} not found`);
      
      if (found.lesson.status !== "assessed") {
        throw new Error(`Lesson must be in 'assessed' status to promote. Current: ${found.lesson.status}`);
      }
      
      const updated: Lesson = {
        ...found.lesson,
        status: "promoted",
        preventionMechanism: mechanism,
        implementationArtifact: artifact,
        updatedAt: new Date().toISOString(),
        revision: found.lesson.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async verifyLesson(lessonId, validationResult) {
      const found = await findLessonImplFn(paths, lessonId);
      if (!found) throw new Error(`Lesson ${lessonId} not found`);
      
      if (found.lesson.status !== "promoted") {
        throw new Error(`Lesson must be in 'promoted' status to verify. Current: ${found.lesson.status}`);
      }
      
      const updated: Lesson = {
        ...found.lesson,
        status: validationResult === "passed" ? "verified" : "candidate",
        validationResult,
        updatedAt: new Date().toISOString(),
        revision: found.lesson.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
    
    async closeLesson(lessonId, reason) {
      const found = await findLessonImplFn(paths, lessonId);
      if (!found) throw new Error(`Lesson ${lessonId} not found`);
      
      const updated: Lesson = {
        ...found.lesson,
        status: "closed",
        closedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        revision: found.lesson.revision + 1,
      };
      
      await writeJsonFile(paths, found.path, updated);
      return updated;
    },
  };
}