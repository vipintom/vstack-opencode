/**
 * Task graph management
 * Handles task graph creation, visualization, and analysis
 */

import { Task, TaskId, TaskStatus, TaskType } from "../schemas/types.js";

export interface TaskGraphNode {
  id: TaskId;
  task: Task;
  x?: number;
  y?: number;
  level: number;
}

export interface TaskGraphEdge {
  from: TaskId;
  to: TaskId;
  type: "depends_on" | "blocks" | "related";
}

export interface TaskGraph {
  nodes: TaskGraphNode[];
  edges: TaskGraphEdge[];
  metadata: {
    totalTasks: number;
    completed: number;
    inProgress: number;
    pending: number;
    blocked: number;
    failed: number;
    criticalPathLength: number;
    maxParallelism: number;
  };
}

export interface TaskGraphLayout {
  nodes: Map<TaskId, { x: number; y: number }>;
  width: number;
  height: number;
}

/**
 * Build a task graph from tasks
 */
export function buildTaskGraph(tasks: Task[]): TaskGraph {
  const nodes: TaskGraphNode[] = [];
  const edges: TaskGraphEdge[] = [];
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  
  // Calculate levels using topological sort
  const levels = calculateLevels(tasks);
  
  for (const task of tasks) {
    nodes.push({
      id: task.id,
      task,
      level: levels.get(task.id) ?? 0,
    });
    
    for (const depId of task.dependencies) {
      if (taskMap.has(depId)) {
        edges.push({
          from: depId,
          to: task.id,
          type: "depends_on",
        });
      }
    }
  }
  
  // Calculate metadata
  const statusCounts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {} as Record<TaskStatus, number>);
  
  // Find critical path length
  const criticalPathLength = findCriticalPathLength(tasks);
  
  // Calculate max parallelism (max tasks at same level)
  const levelCounts = new Map<number, number>();
  for (const [, level] of levels) {
    levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
  }
  const maxParallelism = Math.max(...levelCounts.values(), 0);
  
  return {
    nodes,
    edges,
    metadata: {
      totalTasks: tasks.length,
      completed: statusCounts.completed ?? 0,
      inProgress: statusCounts.in_progress ?? 0,
      pending: statusCounts.pending ?? 0,
      blocked: statusCounts.blocked ?? 0,
      failed: statusCounts.failed ?? 0,
      criticalPathLength,
      maxParallelism,
    },
  };
}

/**
 * Calculate topological levels for tasks
 */
function calculateLevels(tasks: Task[]): Map<TaskId, number> {
  const graph = new Map<TaskId, TaskId[]>();
  const reverseGraph = new Map<TaskId, TaskId[]>();
  
  for (const task of tasks) {
    graph.set(task.id, []);
    reverseGraph.set(task.id, []);
  }
  
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (graph.has(depId)) {
        graph.get(depId)!.push(task.id);
        reverseGraph.get(task.id)!.push(depId);
      }
    }
  }
  
  const levels = new Map<TaskId, number>();
  const visited = new Set<TaskId>();
  
  function computeLevel(taskId: TaskId): number {
    if (levels.has(taskId)) return levels.get(taskId)!;
    if (visited.has(taskId)) return 0; // Cycle protection
    
    visited.add(taskId);
    const deps = reverseGraph.get(taskId) ?? [];
    
    if (deps.length === 0) {
      levels.set(taskId, 0);
    } else {
      const maxDepLevel = Math.max(...deps.map(computeLevel));
      levels.set(taskId, maxDepLevel + 1);
    }
    
    return levels.get(taskId)!;
  }
  
  for (const task of tasks) {
    computeLevel(task.id);
  }
  
  return levels;
}

/**
 * Find critical path length
 */
function findCriticalPathLength(tasks: Task[]): number {
  const graph = new Map<TaskId, TaskId[]>();
  const reverseGraph = new Map<TaskId, TaskId[]>();
  
  for (const task of tasks) {
    graph.set(task.id, []);
    reverseGraph.set(task.id, []);
  }
  
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (graph.has(depId)) {
        graph.get(depId)!.push(task.id);
        reverseGraph.get(task.id)!.push(depId);
      }
    }
  }
  
  const memo = new Map<TaskId, number>();
  
  function longestPath(taskId: TaskId): number {
    if (memo.has(taskId)) return memo.get(taskId)!;
    
    const deps = reverseGraph.get(taskId) ?? [];
    if (deps.length === 0) {
      memo.set(taskId, 1);
      return 1;
    }
    
    const maxDepPath = Math.max(...deps.map(longestPath));
    const result = maxDepPath + 1;
    memo.set(taskId, result);
    return result;
  }
  
  let maxLength = 0;
  for (const task of tasks) {
    maxLength = Math.max(maxLength, longestPath(task.id));
  }
  
  return maxLength;
}

/**
 * Layout task graph for visualization
 */
export function layoutTaskGraph(graph: TaskGraph): TaskGraphLayout {
  const nodePositions = new Map<TaskId, { x: number; y: number }>();
  
  // Group nodes by level
  const levelGroups = new Map<number, TaskGraphNode[]>();
  for (const node of graph.nodes) {
    const group = levelGroups.get(node.level) ?? [];
    group.push(node);
    levelGroups.set(node.level, group);
  }
  
  const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
  const levelSpacing = 200;
  const nodeSpacing = 150;
  
  let maxX = 0;
  let maxY = 0;
  
  for (const level of sortedLevels) {
    const nodes = levelGroups.get(level)!;
    const startX = -(nodes.length - 1) * nodeSpacing / 2;
    
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      const x = startX + i * nodeSpacing;
      const y = level * levelSpacing;
      
      nodePositions.set(node.id, { x, y });
      maxX = Math.max(maxX, Math.abs(x));
      maxY = Math.max(maxY, Math.abs(y));
    }
  }
  
  return {
    nodes: nodePositions,
    width: maxX * 2 + 300,
    height: maxY + 200,
  };
}

/**
 * Find all paths between two tasks
 */
export function findPaths(
  tasks: Task[],
  from: TaskId,
  to: TaskId
): TaskId[][] {
  const graph = new Map<TaskId, TaskId[]>();
  
  for (const task of tasks) {
    graph.set(task.id, []);
  }
  
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (graph.has(depId)) {
        graph.get(depId)!.push(task.id);
      }
    }
  }
  
  const paths: TaskId[][] = [];
  const visited = new Set<TaskId>();
  const path: TaskId[] = [];
  
  function dfs(current: TaskId): void {
    if (visited.has(current)) return;
    
    visited.add(current);
    path.push(current);
    
    if (current === to) {
      paths.push([...path]);
    } else {
      for (const neighbor of graph.get(current) ?? []) {
        dfs(neighbor);
      }
    }
    
    path.pop();
    visited.delete(current);
  }
  
  dfs(from);
  return paths;
}

/**
 * Get all downstream tasks (transitive dependents)
 */
export function getDownstreamTasks(tasks: Task[], taskId: TaskId): Task[] {
  const graph = new Map<TaskId, TaskId[]>();
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  
  for (const task of tasks) {
    graph.set(task.id, []);
  }
  
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      if (graph.has(depId)) {
        graph.get(depId)!.push(task.id);
      }
    }
  }
  
  const visited = new Set<TaskId>();
  const downstream: Task[] = [];
  
  function dfs(current: TaskId): void {
    if (visited.has(current)) return;
    visited.add(current);
    
    for (const neighbor of graph.get(current) ?? []) {
      const task = taskMap.get(neighbor);
      if (task) downstream.push(task);
      dfs(neighbor);
    }
  }
  
  dfs(taskId);
  return downstream;
}

/**
 * Get all upstream tasks (transitive dependencies)
 */
export function getUpstreamTasks(tasks: Task[], taskId: TaskId): Task[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const visited = new Set<TaskId>();
  const upstream: Task[] = [];
  
  function dfs(current: TaskId): void {
    if (visited.has(current)) return;
    visited.add(current);
    
    const task = taskMap.get(current);
    if (!task) return;
    
    for (const depId of task.dependencies) {
      const depTask = taskMap.get(depId);
      if (depTask) upstream.push(depTask);
      dfs(depId);
    }
  }
  
  dfs(taskId);
  return upstream;
}

/**
 * Find tasks that can run in parallel (no dependencies between them)
 */
export function findParallelizableGroups(tasks: Task[]): Task[][] {
  const levels = calculateLevels(tasks);
  const groups = new Map<number, Task[]>();
  
  for (const [taskId, level] of levels) {
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const group = groups.get(level) ?? [];
      group.push(task);
      groups.set(level, group);
    }
  }
  
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => group);
}

/**
 * Check if two tasks can run in parallel
 */
export function canRunInParallel(tasks: Task[], taskA: TaskId, taskB: TaskId): boolean {
  // Check if A depends on B or B depends on A (directly or transitively)
  const upstreamA = getUpstreamTasks(tasks, taskA);
  const upstreamB = getUpstreamTasks(tasks, taskB);
  
  const upstreamAIds = new Set(upstreamA.map(t => t.id));
  const upstreamBIds = new Set(upstreamB.map(t => t.id));
  
  if (upstreamAIds.has(taskB) || upstreamBIds.has(taskA)) {
    return false; // One depends on the other
  }
  
  // Check for common dependencies that might cause conflicts
  // (simplified - in reality would check work scope overlap)
  return true;
}

/**
 * Export graph to DOT format for Graphviz
 */
export function exportToDot(graph: TaskGraph): string {
  let dot = "digraph TaskGraph {\n";
  dot += "  rankdir=TB;\n";
  dot += "  node [shape=box, style=filled];\n\n";
  
  // Nodes with status-based colors
  const statusColors: Record<TaskStatus, string> = {
    pending: "#e0e0e0",
    ready: "#fff3cd",
    assigned: "#cce5ff",
    in_progress: "#b8daff",
    review: "#d4edda",
    completed: "#d4edda",
    blocked: "#f8d7da",
    failed: "#f5c6cb",
    cancelled: "#e2e3e5",
    skipped: "#e2e3e5",
    needs_rework: "#ffe0b2",
  };
  
  for (const node of graph.nodes) {
    const color = statusColors[node.task.status] ?? "#ffffff";
    const label = `${node.task.title}\\n(${node.task.id})`;
    dot += `  "${node.id}" [label="${label}", fillcolor="${color}"];\n`;
  }
  
  dot += "\n";
  
  // Edges
  for (const edge of graph.edges) {
    dot += `  "${edge.from}" -> "${edge.to}";\n`;
  }
  
  dot += "}\n";
  return dot;
}

/**
 * Export graph to Mermaid format
 */
export function exportToMermaid(graph: TaskGraph): string {
  let mermaid = "graph TD\n";
  
  // Nodes
  for (const node of graph.nodes) {
    const status = node.task.status;
    const label = `${node.task.title} (${node.task.id})`;
    
    let style = "";
    switch (status) {
      case "completed": style = "classDef completed fill:#d4edda,stroke:#155724;"; break;
      case "in_progress": style = "classDef in_progress fill:#b8daff,stroke:#004085;"; break;
      case "blocked": style = "classDef blocked fill:#f8d7da,stroke:#721c24;"; break;
      case "failed": style = "classDef failed fill:#f5c6cb,stroke:#721c24;"; break;
      case "pending": style = "classDef pending fill:#e0e0e0,stroke:#383d41;"; break;
      case "ready": style = "classDef ready fill:#fff3cd,stroke:#856404;"; break;
    }
    
    mermaid += `  ${node.id.replace(/-/g, "_")}["${label}"]\n`;
  }
  
  mermaid += "\n";
  
  // Edges
  for (const edge of graph.edges) {
    mermaid += `  ${edge.from.replace(/-/g, "_")} --> ${edge.to.replace(/-/g, "_")}\n`;
  }
  
  // Classes
  mermaid += "\n";
  mermaid += "  classDef completed fill:#d4edda,stroke:#155724;\n";
  mermaid += "  classDef in_progress fill:#b8daff,stroke:#004085;\n";
  mermaid += "  classDef blocked fill:#f8d7da,stroke:#721c24;\n";
  mermaid += "  classDef failed fill:#f5c6cb,stroke:#721c24;\n";
  mermaid += "  classDef pending fill:#e0e0e0,stroke:#383d41;\n";
  mermaid += "  classDef ready fill:#fff3cd,stroke:#856404;\n";
  
  for (const node of graph.nodes) {
    mermaid += `  class ${node.id.replace(/-/g, "_")} ${node.task.status};\n`;
  }
  
  return mermaid;
}

/**
 * Alias for buildTaskGraph
 */
export const createTaskGraph = buildTaskGraph;

/**
 * Get tasks that are ready to run (dependencies satisfied)
 */
export function getReadyTasks(tasks: Task[]): Task[] {
  const completedIds = new Set(tasks.filter(t => t.status === "completed").map(t => t.id));
  return tasks.filter(task => 
    task.status === "pending" || task.status === "ready"
  ).filter(task => 
    task.dependencies.every(depId => completedIds.has(depId))
  );
}

/**
 * Get execution order (topological sort)
 */
export function getExecutionOrder(tasks: Task[]): Task[] {
  const graph = buildTaskGraph(tasks);
  // Simple topological sort based on levels
  const sortedNodes = [...graph.nodes].sort((a, b) => a.level - b.level);
  return sortedNodes.map(n => n.task);
}

/**
 * Alias for findParallelizableGroups
 */
export const getParallelizableGroups = findParallelizableGroups;