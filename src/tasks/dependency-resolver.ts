/**
 * Task dependency resolver
 * Handles topological sorting, critical path analysis, and scheduling
 */

import { Task, TaskStatus, TaskType } from "../schemas/types.js";

export interface TopologicalOrder {
  ordered: Task[];
  levels: Task[][]; // tasks at same level can run in parallel
  hasCycles: boolean;
  cycles: string[][];
}

export interface CriticalPathResult {
  criticalPath: Task[];
  totalDuration: number; // estimated
  parallelizableGroups: Task[][];
  bottlenecks: Task[];
}

export interface SchedulePlan {
  tasks: ScheduledTask[];
  maxParallelism: number;
  estimatedDuration: number;
}

export interface ScheduledTask {
  task: Task;
  earliestStart: number; // relative time units
  latestStart: number;
  slack: number;
  dependsOn: string[];
  parallelGroup: number;
}

/**
 * Perform topological sort on tasks
 */
export function topologicalSort(tasks: Task[]): TopologicalOrder {
  const graph = new Map<string, Task>();
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  
  // Build graph
  for (const task of tasks) {
    graph.set(task.id, task);
    inDegree.set(task.id, 0);
    adjList.set(task.id, []);
  }
  
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (graph.has(depId)) {
        adjList.get(depId)!.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
      }
    }
  }
  
  // Kahn's algorithm
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }
  
  const ordered: Task[] = [];
  const levels: Task[][] = [];
  const visited = new Set<string>();
  
  while (queue.length > 0) {
    const levelSize = queue.length;
    const currentLevel: Task[] = [];
    
    for (let i = 0; i < levelSize; i++) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      
      visited.add(node);
      const task = graph.get(node)!;
      ordered.push(task);
      currentLevel.push(task);
      
      for (const neighbor of adjList.get(node) ?? []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }
    
    if (currentLevel.length > 0) {
      levels.push(currentLevel);
    }
  }
  
  // Check for cycles
  const hasCycles = ordered.length !== tasks.length;
  let cycles: string[][] = [];
  
  if (hasCycles) {
    cycles = findAllCycles(tasks);
  }
  
  return { ordered, levels, hasCycles, cycles };
}

/**
 * Find all cycles in the task graph
 */
function findAllCycles(tasks: Task[]): string[][] {
  const graph = new Map<string, string[]>();
  for (const task of tasks) {
    graph.set(task.id, [...task.dependencies]);
  }
  
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];
  const cycles: string[][] = [];
  
  function dfs(node: string): void {
    if (recStack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push(path.slice(cycleStart).concat(node));
      return;
    }
    
    if (visited.has(node)) return;
    
    visited.add(node);
    recStack.add(node);
    path.push(node);
    
    const neighbors = graph.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }
    
    recStack.delete(node);
    path.pop();
  }
  
  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }
  
  return cycles;
}

/**
 * Calculate critical path
 */
export function calculateCriticalPath(
  tasks: Task[],
  durationEstimates: Map<string, number>
): CriticalPathResult {
  const graph = new Map<string, Task>();
  const reverseGraph = new Map<string, string[]>();
  
  for (const task of tasks) {
    graph.set(task.id, task);
    reverseGraph.set(task.id, []);
  }
  
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (graph.has(depId)) {
        reverseGraph.get(task.id)!.push(depId);
      }
    }
  }
  
  // Forward pass - earliest start times
  const earliestStart = new Map<string, number>();
  const topological = topologicalSort(tasks);
  
  for (const task of topological.ordered) {
    let maxEarliest = 0;
    for (const depId of task.dependencies) {
      if (earliestStart.has(depId)) {
        const depDuration = durationEstimates.get(depId) ?? 1;
        maxEarliest = Math.max(maxEarliest, earliestStart.get(depId)! + depDuration);
      }
    }
    earliestStart.set(task.id, maxEarliest);
  }
  
  // Backward pass - latest start times
  const latestStart = new Map<string, number>();
  const projectEnd = Math.max(...earliestStart.values()) + 
    Math.max(...Array.from(earliestStart.entries())
      .map(([id, es]) => es + (durationEstimates.get(id) ?? 1)));
  
  // Process in reverse topological order
  for (const task of [...topological.ordered].reverse()) {
    let minLatest = projectEnd - (durationEstimates.get(task.id) ?? 1);
    
    // Find tasks that depend on this one
    for (const otherTask of tasks) {
      if (otherTask.dependencies.includes(task.id)) {
        if (latestStart.has(otherTask.id)) {
          minLatest = Math.min(minLatest, latestStart.get(otherTask.id)!);
        }
      }
    }
    
    latestStart.set(task.id, Math.max(earliestStart.get(task.id)!, minLatest));
  }
  
  // Calculate slack and identify critical path
  const scheduledTasks: ScheduledTask[] = [];
  for (const task of tasks) {
    const es = earliestStart.get(task.id) ?? 0;
    const ls = latestStart.get(task.id) ?? 0;
    const slack = ls - es;
    
    scheduledTasks.push({
      task,
      earliestStart: es,
      latestStart: ls,
      slack,
      dependsOn: [...task.dependencies],
      parallelGroup: 0, // Will be assigned below
    });
  }
  
  // Identify critical path (zero slack)
  const criticalPath = scheduledTasks
    .filter(st => st.slack === 0)
    .sort((a, b) => a.earliestStart - b.earliestStart)
    .map(st => st.task);
  
  // Group parallelizable tasks (same earliestStart, non-critical)
  const parallelGroups = new Map<number, Task[]>();
  for (const st of scheduledTasks) {
    if (st.slack > 0) {
      const group = parallelGroups.get(st.earliestStart) ?? [];
      group.push(st.task);
      parallelGroups.set(st.earliestStart, group);
    }
  }
  
  // Assign parallel group numbers
  let groupNum = 1;
  for (const st of scheduledTasks.sort((a, b) => a.earliestStart - b.earliestStart)) {
    if (st.slack > 0) {
      st.parallelGroup = groupNum;
      groupNum++;
    }
  }
  
  // Identify bottlenecks (tasks with many dependents)
  const dependentCount = new Map<string, number>();
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      dependentCount.set(depId, (dependentCount.get(depId) ?? 0) + 1);
    }
  }
  
  const bottlenecks = scheduledTasks
    .filter(st => (dependentCount.get(st.task.id) ?? 0) > 2)
    .sort((a, b) => (dependentCount.get(b.task.id) ?? 0) - (dependentCount.get(a.task.id) ?? 0))
    .map(st => st.task);
  
  return {
    criticalPath,
    totalDuration: projectEnd,
    parallelizableGroups: Array.from(parallelGroups.values()),
    bottlenecks,
  };
}

/**
 * Create schedule plan with parallelism limit
 */
export function createSchedulePlan(
  tasks: Task[],
  maxParallelism: number,
  durationEstimates: Map<string, number>
): SchedulePlan {
  const criticalPathResult = calculateCriticalPath(tasks, durationEstimates);
  const topological = topologicalSort(tasks);
  
  const scheduled: ScheduledTask[] = [];
  const running = new Set<string>();
  const completed = new Set<string>();
  let currentTime = 0;
  
  // Use level-based scheduling from topological sort
  for (const level of topological.levels) {
    // Schedule tasks in this level with parallelism limit
    let levelTime = 0;
    const levelBatches: Task[][] = [];
    let currentBatch: Task[] = [];
    
    for (const task of level) {
      if (currentBatch.length >= maxParallelism) {
        levelBatches.push([...currentBatch]);
        currentBatch = [];
      }
      currentBatch.push(task);
    }
    if (currentBatch.length > 0) {
      levelBatches.push(currentBatch);
    }
    
    // Assign times to batches
    for (const batch of levelBatches) {
      const batchDuration = Math.max(...batch.map(t => durationEstimates.get(t.id) ?? 1));
      
      for (const task of batch) {
        const duration = durationEstimates.get(task.id) ?? 1;
        const dependsOn = [...task.dependencies];
        
        scheduled.push({
          task,
          earliestStart: currentTime,
          latestStart: currentTime, // Simplified
          slack: 0,
          dependsOn,
          parallelGroup: scheduled.length + 1,
        });
      }
      
      currentTime += batchDuration;
    }
  }
  
  return {
    tasks: scheduled,
    maxParallelism,
    estimatedDuration: currentTime,
  };
}

/**
 * Estimate task duration based on type and complexity
 */
export function estimateTaskDuration(task: Task, baseEstimates: Map<TaskType, number>): number {
  const baseDuration = baseEstimates.get(task.type) ?? 1;
  
  // Adjust for priority
  const priorityMultiplier = {
    low: 0.8,
    medium: 1.0,
    high: 1.2,
    critical: 1.5,
  }[task.priority] ?? 1.0;
  
  // Adjust for number of dependencies (coordination overhead)
  const depOverhead = 1 + (task.dependencies.length * 0.1);
  
  // Adjust for max attempts (rework risk)
  const reworkRisk = 1 + ((task.maxAttempts - 1) * 0.2);
  
  return Math.ceil(baseDuration * priorityMultiplier * depOverhead * reworkRisk);
}

/**
 * Get default duration estimates for task types
 */
export function getDefaultDurationEstimates(): Map<TaskType, number> {
  return new Map([
    ["discovery", 2],
    ["design", 3],
    ["planning", 2],
    ["implementation", 5],
    ["testing", 3],
    ["review", 2],
    ["documentation", 2],
    ["release", 2],
    ["deployment", 2],
    ["operations", 2],
    ["other", 2],
  ]);
}