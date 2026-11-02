/**
 * Simplified Task Store
 * 
 * CRUD + dependencies for tasks without phase coupling.
 * Works with simplified delivery model.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, listDirs, fileExists, deleteFile } from "../persistence/file-store.js";
import { Task, TaskId, TaskStatus, TaskType, TaskId as TaskIdType, deliveryId, TaskContract } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface TaskStore {
  createTask(params: CreateTaskParams): Promise<Task>;
  getTask(taskId: TaskId): Promise<Task | null>;
  listTasks(deliveryId: string, filters?: TaskFilters): Promise<Task[]>;
  updateTask(taskId: TaskId, updates: TaskUpdates): Promise<Task>;
  deleteTask(taskId: TaskId): Promise<void>;
  addDependency(taskId: TaskId, dependsOnTaskId: TaskId): Promise<Task>;
  removeDependency(taskId: TaskId, dependsOnTaskId: TaskId): Promise<Task>;
  getReadyTasks(deliveryId: string): Promise<Task[]>;
  getTaskDependencies(taskId: TaskId): Promise<TaskId[]>;
  getTaskDependents(deliveryId: string, taskId: TaskId): Promise<TaskId[]>;
}

export interface CreateTaskParams {
  deliveryId: string;
  title: string;
  description: string;
  type: TaskType;
  priority: "low" | "medium" | "high" | "critical";
  dependencies: TaskId[];
  acceptanceCriteria: string[];
  expectedOutputs: string[];
  requiredSkills: string[];
  workScope: string;
  worktreePath: string | null;
  maxAttempts: number;
  assignedAgentId: string | null;
  contract?: TaskContract;
}

export interface TaskFilters {
  status?: TaskStatus[];
  type?: TaskType[];
  assignedAgentId?: string;
}

export interface TaskUpdates {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: Task["priority"];
  acceptanceCriteria?: string[];
  expectedOutputs?: string[];
  workScope?: string;
  worktreePath?: string | null;
  resultSummary?: string;
  evidenceIds?: string[];
  dependencies?: TaskId[];
  assignedAgentId?: string;
  assignedSessionId?: string;
}

function taskDir(paths: VstackPaths, deliveryId: string): string {
  return resolve(paths.deliveries, deliveryId, "tasks");
}

function taskFile(paths: VstackPaths, deliveryId: string, taskId: string): string {
  return resolve(taskDir(paths, deliveryId), `${taskId}.json`);
}

const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["ready", "assigned", "completed", "cancelled", "skipped", "needs_rework"],
  ready: ["in_progress", "assigned", "completed", "cancelled", "skipped", "blocked", "needs_rework"],
  assigned: ["in_progress", "ready", "completed", "cancelled", "blocked", "needs_rework"],
  in_progress: ["review", "completed", "blocked", "failed", "cancelled", "needs_rework"],
  review: ["completed", "failed", "in_progress", "blocked", "needs_rework"],
  completed: [],
  blocked: ["ready", "in_progress", "cancelled", "failed", "needs_rework"],
  failed: ["ready", "in_progress", "cancelled", "needs_rework"],
  cancelled: [],
  skipped: [],
  needs_rework: ["ready", "in_progress", "cancelled"],
};

function canTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

function detectCycles(tasks: Task[]): TaskId[][] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set<TaskId>();
  const recStack = new Set<TaskId>();
  const cycles: TaskId[][] = [];
  
  function dfs(taskId: TaskId, path: TaskId[]): void {
    if (recStack.has(taskId)) {
      const cycleStart = path.indexOf(taskId);
      cycles.push(path.slice(cycleStart).concat(taskId));
      return;
    }
    
    if (visited.has(taskId)) return;
    
    visited.add(taskId);
    recStack.add(taskId);
    path.push(taskId);
    
    const task = taskMap.get(taskId);
    if (task?.dependencies) {
      for (const depId of task.dependencies) {
        dfs(depId, [...path]);
      }
    }
    
    recStack.delete(taskId);
    path.pop();
  }
  
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      dfs(task.id, []);
    }
  }
  
  return cycles;
}

async function getAllTasksImpl(paths: VstackPaths, deliveryId: string): Promise<Task[]> {
  const taskIds = listFiles(paths, taskDir(paths, deliveryId));
  const tasks: Task[] = [];
  
  for (const taskId of taskIds) {
    const task = await readJsonFile<Task>(paths, taskFile(paths, deliveryId, taskId));
    if (task) tasks.push(task);
  }
  
  tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return tasks;
}

async function findTaskImpl(paths: VstackPaths, taskId: TaskId): Promise<{ task: Task; taskPath: string } | null> {
  const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
  for (const dir of deliveryDirs) {
    const taskPath = resolve(paths.deliveries, dir, "tasks", `${taskId}.json`);
    const task = await readJsonFile<Task>(paths, taskPath);
    if (task) return { task, taskPath };
  }
  return null;
}

async function updateTaskImpl(paths: VstackPaths, taskId: TaskId, updates: TaskUpdates): Promise<Task> {
  const found = await findTaskImpl(paths, taskId);
  if (!found) throw new Error(`Task ${taskId} not found`);
  
  const { task, taskPath } = found;
  
  if (updates.status && !canTaskTransition(task.status, updates.status)) {
    throw new Error(`Invalid task transition: ${task.status} -> ${updates.status}`);
  }
  
  const updatedTask: Task = {
    ...task,
    ...updates,
    updatedAt: new Date().toISOString(),
    revision: task.revision + 1,
    completedAt: updates.status === "completed" ? new Date().toISOString() : task.completedAt,
    startedAt: updates.status === "in_progress" && !task.startedAt ? new Date().toISOString() : task.startedAt,
    evidenceIds: updates.evidenceIds ? updates.evidenceIds.map(e => e as any) : task.evidenceIds,
  };
  
  await writeJsonFile(paths, taskPath, updatedTask);
  return updatedTask;
}

export async function createTaskStore(paths: VstackPaths): Promise<TaskStore> {
  return {
    async createTask(params) {
      const newTaskId = `tsk_${uuidv4()}` as TaskId;
      const now = new Date().toISOString();
      
      // Validate dependencies exist
      for (const depId of params.dependencies) {
        const depTask = await readJsonFile<Task>(paths, taskFile(paths, params.deliveryId, depId));
        if (!depTask) {
          throw new Error(`Dependency task not found: ${depId}`);
        }
      }
      
      // Check for cycles
      const allTasks = await getAllTasksImpl(paths, params.deliveryId);
      const testTask = {
        id: newTaskId,
        deliveryId: params.deliveryId,
        dependencies: params.dependencies,
      } as Task;
      const cycles = detectCycles([...allTasks, testTask]);
      if (cycles.length > 0 && cycles[0]) {
        throw new Error(`Adding task would create dependency cycle: ${cycles[0].join(" -> ")}`);
      }
      
      const task: Task = {
        schemaVersion: 1,
        id: newTaskId,
        deliveryId: params.deliveryId as any,
        phaseRunId: null as any,
        title: params.title,
        description: params.description,
        type: params.type,
        status: "pending",
        priority: params.priority,
        dependencies: params.dependencies,
        assignedAgentId: params.assignedAgentId,
        assignedSessionId: null,
        workScope: params.workScope,
        acceptanceCriteria: params.acceptanceCriteria,
        expectedOutputs: params.expectedOutputs,
        requiredSkills: params.requiredSkills,
        worktreePath: params.worktreePath,
        attemptCount: 0,
        maxAttempts: params.maxAttempts,
        resultSummary: null,
        evidenceIds: [],
        blocker: null,
        contract: params.contract ?? null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        startedAt: null,
      };
      
      // Ensure task directory exists
      const { mkdirSync } = await import("node:fs");
      const taskDirPath = taskDir(paths, params.deliveryId);
      mkdirSync(taskDirPath, { recursive: true });
      
      await writeJsonFile(paths, taskFile(paths, params.deliveryId, newTaskId), task);
      return task;
    },

    async getTask(taskId) {
      const found = await findTaskImpl(paths, taskId);
      return found?.task ?? null;
    },

    async listTasks(deliveryId, filters = {}) {
      const tasks = await getAllTasksImpl(paths, deliveryId);
      let filtered = tasks;
      if (filters.status) filtered = filtered.filter(t => filters.status!.includes(t.status));
      if (filters.type) filtered = filtered.filter(t => filters.type!.includes(t.type));
      if (filters.assignedAgentId) filtered = filtered.filter(t => t.assignedAgentId === filters.assignedAgentId);
      return filtered;
    },

    async updateTask(taskId, updates) {
      return updateTaskImpl(paths, taskId, updates);
    },

    async deleteTask(taskId) {
      let task: Task | null = null;
      let foundDeliveryId: string | null = null;
      
      const taskAttempt = await readJsonFile<Task>(paths, taskFile(paths, "", taskId));
      if (taskAttempt) {
        task = taskAttempt;
        foundDeliveryId = task.deliveryId;
      } else {
        // Find the task first
        const found = await (async () => {
          const deliveryDirs = listDirs(paths, resolve(paths.deliveries));
          for (const dir of deliveryDirs) {
            const t = await readJsonFile<Task>(paths, taskFile(paths, dir, taskId));
            if (t) return { task: t, deliveryId: dir };
          }
          return null;
        })();
        if (!found) throw new Error(`Task ${taskId} not found`);
        task = found.task;
        foundDeliveryId = found.deliveryId;
      }
      
      if (!foundDeliveryId) throw new Error(`Task ${taskId} not found`);
      
      // Check dependents
      const allTasks = await getAllTasksImpl(paths, foundDeliveryId);
      const dependents = allTasks.filter(t => t.dependencies.includes(taskId));
      if (dependents.length > 0) {
        throw new Error(`Cannot delete task: ${dependents.length} tasks depend on it`);
      }
      
      await deleteFile(paths, taskFile(paths, foundDeliveryId, taskId));
    },

    async addDependency(taskId: TaskId, dependsOnTaskId: TaskId) {
      const task = await readJsonFile<Task>(paths, taskFile(paths, "", taskId));
      if (!task) throw new Error(`Task ${taskId} not found`);
      
      if (task.dependencies.includes(dependsOnTaskId)) {
        throw new Error(`Dependency already exists: ${dependsOnTaskId}`);
      }
      
      const depTask = await readJsonFile<Task>(paths, taskFile(paths, task.deliveryId, dependsOnTaskId));
      if (!depTask) throw new Error(`Dependency task not found: ${dependsOnTaskId}`);
      if (depTask.deliveryId !== task.deliveryId) {
        throw new Error(`Dependency must be in same delivery`);
      }
      
      const allTasks = await getAllTasksImpl(paths, task.deliveryId);
      const testTask = { ...task, dependencies: [...task.dependencies, dependsOnTaskId] };
      const cycles = detectCycles([...allTasks.filter(t => t.id !== taskId), testTask]);
      if (cycles.length > 0 && cycles[0]) {
        throw new Error(`Adding dependency would create cycle: ${cycles[0].join(" -> ")}`);
      }
      
      return updateTaskImpl(paths, taskId, {
        dependencies: [...task.dependencies, dependsOnTaskId],
      });
    },

    async removeDependency(taskId: TaskId, dependsOnTaskId: TaskId) {
      const task = await readJsonFile<Task>(paths, taskFile(paths, "", taskId));
      if (!task) throw new Error(`Task ${taskId} not found`);
      
      if (!task.dependencies.includes(dependsOnTaskId)) {
        throw new Error(`Dependency not found: ${dependsOnTaskId}`);
      }
      
      return updateTaskImpl(paths, taskId, {
        dependencies: task.dependencies.filter(d => d !== dependsOnTaskId),
      });
    },

    async getReadyTasks(deliveryId: string) {
      const tasks = await getAllTasksImpl(paths, deliveryId);
      
      const completedTaskIds = new Set(
        tasks.filter(t => t.status === "completed").map(t => t.id)
      );
      
      return tasks.filter(task => {
        if (task.status !== "pending" && task.status !== "ready") return false;
        return task.dependencies.every(depId => completedTaskIds.has(depId));
      });
    },

    async getTaskDependencies(taskId: TaskId) {
      const found = await findTaskImpl(paths, taskId);
      return found?.task.dependencies ?? [];
    },

    async getTaskDependents(deliveryId: string, taskId: TaskId) {
      const allTasks = await getAllTasksImpl(paths, deliveryId);
      return allTasks
        .filter((t: Task) => t.dependencies.includes(taskId))
        .map((t: Task) => t.id);
    },
  };
}