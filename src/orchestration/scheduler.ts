/**
 * Task scheduler
 * Schedules tasks based on dependencies, priority, agent availability, and parallelism limits
 */

import { Task, TaskId, TaskStatus, TaskType } from "../schemas/types.js";
import { AgentProfile, DEFAULT_AGENT_PROFILES } from "../tasks/assignment.js";

export type TaskPriority = "low" | "medium" | "high" | "critical";

export interface SchedulerConfig {
  maxConcurrentTasks: number;
  maxConcurrentAgents: number;
  priorityWeights: Record<TaskPriority, number>;
  enableWorktreeIsolation: boolean;
  rebalanceInterval: number; // ms
}

export interface ScheduledTask {
  taskId: TaskId;
  agentId: string;
  scheduledAt: string;
  estimatedDuration: number;
  priority: number;
  dependencies: TaskId[];
}

export interface ScheduleResult {
  scheduled: ScheduledTask[];
  deferred: TaskId[];
  conflicts: ScheduleConflict[];
  nextRunAt: string;
}

export interface ScheduleConflict {
  taskId: TaskId;
  type: "agent_overload" | "dependency_not_ready" | "worktree_conflict" | "resource_exhausted";
  message: string;
}

/**
 * Default scheduler configuration
 */
export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxConcurrentTasks: 10,
  maxConcurrentAgents: 3,
  priorityWeights: {
    low: 1,
    medium: 2,
    high: 3,
    critical: 5,
  },
  enableWorktreeIsolation: false,
  rebalanceInterval: 30000, // 30 seconds
};

/**
 * Create a task scheduler
 */
export function createScheduler(config: Partial<SchedulerConfig> = {}) {
  const fullConfig = { ...DEFAULT_SCHEDULER_CONFIG, ...config };
  let lastRebalance = Date.now();
  
  return {
    /**
     * Create a schedule for ready tasks
     */
    createSchedule(
      readyTasks: Task[],
      availableAgents: AgentProfile[],
      currentAssignments: Map<TaskId, { agentId: string; scheduledAt: string }>
    ): ScheduleResult {
      const scheduled: ScheduledTask[] = [];
      const deferred: TaskId[] = [];
      const conflicts: ScheduleConflict[] = [];
      
      // Sort tasks by priority and readiness
      const sortedTasks = [...readyTasks].sort((a, b) => {
        // Higher priority first
        const priorityA = a.priority ?? "medium";
        const priorityB = b.priority ?? "medium";
        const priorityDiff = fullConfig.priorityWeights[priorityB] - fullConfig.priorityWeights[priorityA];
        if (priorityDiff !== 0) return priorityDiff;
        
        // Fewer dependencies first
        return a.dependencies.length - b.dependencies.length;
      });
      
      // Track agent workloads
      const agentWorkloads = new Map<string, number>();
      for (const agent of availableAgents) {
        agentWorkloads.set(agent.id, agent.currentTasks.length);
      }
      
      // Track worktree usage
      const worktreeUsage = new Map<string, number>();
      
      for (const task of sortedTasks) {
        // Check if already assigned
        if (currentAssignments.has(task.id)) {
          scheduled.push({
            taskId: task.id,
            agentId: currentAssignments.get(task.id)!.agentId,
            scheduledAt: currentAssignments.get(task.id)!.scheduledAt,
            estimatedDuration: estimateDuration(task),
            priority: fullConfig.priorityWeights[task.priority ?? "medium"],
            dependencies: [...task.dependencies],
          });
          continue;
        }
        
        // Find best available agent
        const agent = findAvailableAgent(task, availableAgents, agentWorkloads, worktreeUsage);
        
        if (agent) {
          // Check worktree conflict
          if (fullConfig.enableWorktreeIsolation && task.worktreePath) {
            const usage = worktreeUsage.get(task.worktreePath) ?? 0;
            if (usage > 0) {
              conflicts.push({
                taskId: task.id,
                type: "worktree_conflict",
                message: `Worktree ${task.worktreePath} already in use`,
              });
              deferred.push(task.id);
              continue;
            }
            worktreeUsage.set(task.worktreePath, usage + 1);
          }
          
          // Check agent capacity
          const currentLoad = agentWorkloads.get(agent.id) ?? 0;
          if (currentLoad >= agent.maxConcurrentTasks) {
            conflicts.push({
              taskId: task.id,
              type: "agent_overload",
              message: `Agent ${agent.id} at capacity (${currentLoad}/${agent.maxConcurrentTasks})`,
            });
            deferred.push(task.id);
            continue;
          }
          
          // Schedule task
          agentWorkloads.set(agent.id, currentLoad + 1);
          const now = new Date().toISOString();
          
          scheduled.push({
            taskId: task.id,
            agentId: agent.id,
            scheduledAt: now,
            estimatedDuration: estimateDuration(task),
            priority: fullConfig.priorityWeights[task.priority ?? "medium"],
            dependencies: [...task.dependencies],
          });
          
          currentAssignments.set(task.id, { agentId: agent.id, scheduledAt: now });
        } else {
          // No available agent
          deferred.push(task.id);
        }
      }
      
      return {
        scheduled,
        deferred,
        conflicts,
        nextRunAt: new Date(Date.now() + fullConfig.rebalanceInterval).toISOString(),
      };
    },
    
    /**
     * Rebalance schedule (move tasks between agents)
     */
    rebalance(
      scheduled: ScheduledTask[],
      availableAgents: AgentProfile[]
    ): ScheduleResult {
      // Rebuild assignments from scheduled
      const currentAssignments = new Map<TaskId, { agentId: string; scheduledAt: string }>();
      for (const st of scheduled) {
        currentAssignments.set(st.taskId, { agentId: st.agentId, scheduledAt: st.scheduledAt });
      }
      
      // Get task objects (would need to be passed in)
      // For now, return as-is
      return {
        scheduled,
        deferred: [],
        conflicts: [],
        nextRunAt: new Date(Date.now() + fullConfig.rebalanceInterval).toISOString(),
      };
    },
    
    /**
     * Check if rebalance is needed
     */
    shouldRebalance(scheduled: ScheduledTask[], availableAgents: AgentProfile[]): boolean {
      const now = Date.now();
      if (now - lastRebalance < fullConfig.rebalanceInterval) return false;
      
      // Check for significant workload imbalance
      const agentLoads = new Map<string, number>();
      for (const st of scheduled) {
        agentLoads.set(st.agentId, (agentLoads.get(st.agentId) || 0) + 1);
      }
      
      const loads = Array.from(agentLoads.values());
      if (loads.length === 0) return false;
      
      const maxLoad = Math.max(...loads);
      const minLoad = Math.min(...loads);
      
      // Rebalance if difference > 2
      return maxLoad - minLoad > 2;
    },
    
    /**
     * Get next task to schedule
     */
    getNextTask(readyTasks: Task[], availableAgents: AgentProfile[]): Task | null {
      if (readyTasks.length === 0) return null;
      
      // Return highest priority ready task
      const sorted = readyTasks.sort((a, b) => 
        fullConfig.priorityWeights[b.priority ?? "medium"] - fullConfig.priorityWeights[a.priority ?? "medium"]
      );
      return sorted[0] ?? null;
    },
  };
}

/**
 * Find an available agent for a task
 */
function findAvailableAgent(
  task: Task,
  availableAgents: AgentProfile[],
  agentWorkloads: Map<string, number>,
  worktreeUsage: Map<string, number>
): AgentProfile | null {
  // Get preferred agent types for this task
  const preferredTypes = getPreferredAgentTypes(task);
  
  // Filter available agents
  const candidates = availableAgents.filter(agent => {
    // Must be available
    if (agent.availability !== "available") return false;
    
    // Must have capacity
    const currentLoad = agentWorkloads.get(agent.id) ?? 0;
    if (currentLoad >= agent.maxConcurrentTasks) return false;
    
    // Should match preferred type (if any specified)
    if (preferredTypes.length > 0 && !preferredTypes.includes(agent.type)) {
      // Allow fallback if no preferred type available
      const hasPreferredAvailable = availableAgents.some(a => 
        a.availability === "available" && 
        a.currentTasks.length < a.maxConcurrentTasks &&
        preferredTypes.includes(a.type)
      );
      if (hasPreferredAvailable) return false;
    }
    
    return true;
  });
  
  if (candidates.length === 0) return null;
  
  // Sort by: matching type (preferred), then by load (ascending)
  candidates.sort((a, b) => {
    const aPreferred = preferredTypes.includes(a.type) ? 1 : 0;
    const bPreferred = preferredTypes.includes(b.type) ? 1 : 0;
    
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;
    
    const aLoad = agentWorkloads.get(a.id) ?? 0;
    const bLoad = agentWorkloads.get(b.id) ?? 0;
    return aLoad - bLoad;
  });
  
  return candidates[0] ?? null;
}

/**
 * Get preferred agent types for a task
 */
function getPreferredAgentTypes(task: Task): string[] {
  const typeMap: Record<TaskType, string[]> = {
    discovery: ["vstack-architect"],
    design: ["vstack-architect"],
    planning: ["vstack-lead", "vstack-architect"],
    implementation: ["vstack-developer"],
    testing: ["vstack-test-engineer", "vstack-developer"],
    review: ["vstack-reviewer"],
    documentation: ["vstack-developer", "vstack-architect", "vstack-operator"],
    release: ["vstack-operator", "vstack-lead"],
    deployment: ["vstack-operator"],
    operations: ["vstack-operator"],
    other: ["vstack-developer", "vstack-lead"],
  };
  
  return typeMap[task.type] ?? ["vstack-developer"];
}

/**
 * Estimate task duration in minutes
 */
function estimateDuration(task: Task): number {
  const baseDurations: Record<TaskType, number> = {
    discovery: 30,
    design: 45,
    planning: 30,
    implementation: 60,
    testing: 45,
    review: 30,
    documentation: 30,
    release: 30,
    deployment: 30,
    operations: 30,
    other: 30,
  };
  
  const base = baseDurations[task.type] ?? 30;
  
  // Adjust for priority
  const priorityMultiplier: Record<TaskPriority, number> = {
    low: 0.8,
    medium: 1.0,
    high: 1.2,
    critical: 1.5,
  };
  
  // Adjust for dependencies
  const depFactor = 1 + (task.dependencies.length * 0.1);
  
  return Math.round(base * priorityMultiplier[task.priority] * depFactor);
}

/**
 * Get schedule statistics
 */
export function getScheduleStats(
  scheduled: ScheduledTask[],
  availableAgents: AgentProfile[]
): {
  totalScheduled: number;
  agentUtilization: Record<string, { tasks: number; capacity: number; utilization: number }>;
  averagePriority: number;
  estimatedTotalDuration: number;
} {
  const agentStats: Record<string, { tasks: number; capacity: number; utilization: number }> = {};
  
  for (const agent of availableAgents) {
    const tasks = scheduled.filter(s => s.agentId === agent.id);
    agentStats[agent.id] = {
      tasks: tasks.length,
      capacity: agent.maxConcurrentTasks,
      utilization: tasks.length / agent.maxConcurrentTasks,
    };
  }
  
  const priorities = scheduled.map(s => s.priority);
  const avgPriority = priorities.length > 0 
    ? priorities.reduce((a, b) => a + b, 0) / priorities.length 
    : 0;
  
  const estimatedTotalDuration = scheduled.reduce((sum, s) => sum + s.estimatedDuration, 0);
  
  return {
    totalScheduled: scheduled.length,
    agentUtilization: agentStats,
    averagePriority: avgPriority,
    estimatedTotalDuration,
  };
}