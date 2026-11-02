/**
 * Task assignment and agent matching
 * Matches tasks to appropriate agents based on skills, availability, and workload
 */

import { Task, TaskType, TaskStatus, TaskId } from "../schemas/types.js";

export interface AgentProfile {
  id: string;
  name: string;
  type: "vstack-lead" | "vstack-architect" | "vstack-developer" | "vstack-test-engineer" | "vstack-reviewer" | "vstack-operator";
  skills: string[];
  maxConcurrentTasks: number;
  currentTasks: string[];
  availability: "available" | "busy" | "offline";
}

export interface AssignmentResult {
  taskId: TaskId;
  agentId: string;
  confidence: number;
  reason: string;
  alternatives: Array<{ agentId: string; confidence: number; reason: string }>;
}

export interface WorkloadReport {
  agentId: string;
  assignedTasks: number;
  maxConcurrent: number;
  utilization: number; // 0-1
  queuedTasks: string[];
}

/**
 * Default agent profiles with their capabilities
 */
export const DEFAULT_AGENT_PROFILES: AgentProfile[] = [
  {
    id: "vstack-lead",
    name: "Lead (Whale)",
    type: "vstack-lead",
    skills: ["vstack-planning", "vstack-review", "vstack-documentation", "vstack-release", "vstack-operations"],
    maxConcurrentTasks: 3,
    currentTasks: [],
    availability: "available",
  },
  {
    id: "vstack-architect",
    name: "Architect",
    type: "vstack-architect",
    skills: ["vstack-discovery", "vstack-architecture", "vstack-planning"],
    maxConcurrentTasks: 2,
    currentTasks: [],
    availability: "available",
  },
  {
    id: "vstack-developer",
    name: "Developer",
    type: "vstack-developer",
    skills: ["vstack-implementation", "vstack-debugging", "vstack-testing", "vstack-documentation"],
    maxConcurrentTasks: 3,
    currentTasks: [],
    availability: "available",
  },
  {
    id: "vstack-test-engineer",
    name: "Test Engineer",
    type: "vstack-test-engineer",
    skills: ["vstack-testing", "vstack-debugging"],
    maxConcurrentTasks: 2,
    currentTasks: [],
    availability: "available",
  },
  {
    id: "vstack-reviewer",
    name: "Reviewer (Goldfish)",
    type: "vstack-reviewer",
    skills: ["vstack-review"],
    maxConcurrentTasks: 1,
    currentTasks: [],
    availability: "available",
  },
  {
    id: "vstack-operator",
    name: "Operator",
    type: "vstack-operator",
    skills: ["vstack-release", "vstack-operations", "vstack-documentation"],
    maxConcurrentTasks: 2,
    currentTasks: [],
    availability: "available",
  },
];

/**
 * Task type to agent type mapping
 */
export const TASK_TYPE_AGENT_MAP: Record<TaskType, string[]> = {
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

/**
 * Skill to agent type mapping
 */
export const SKILL_AGENT_MAP: Record<string, string[]> = {
  "vstack-discovery": ["vstack-architect"],
  "vstack-architecture": ["vstack-architect"],
  "vstack-planning": ["vstack-lead", "vstack-architect"],
  "vstack-implementation": ["vstack-developer"],
  "vstack-debugging": ["vstack-developer", "vstack-test-engineer"],
  "vstack-testing": ["vstack-test-engineer", "vstack-developer"],
  "vstack-review": ["vstack-reviewer"],
  "vstack-documentation": ["vstack-developer", "vstack-architect", "vstack-operator"],
  "vstack-release": ["vstack-operator", "vstack-lead"],
  "vstack-operations": ["vstack-operator"],
};

/**
 * Find best agent for a task
 */
export function findBestAgent(
  task: Task,
  availableAgents: AgentProfile[]
): AssignmentResult {
  const candidateAgents = getCandidateAgents(task, availableAgents);
  
  if (candidateAgents.length === 0) {
    return {
      taskId: task.id,
      agentId: "",
      confidence: 0,
      reason: "No suitable agents available",
      alternatives: [],
    };
  }
  
  // Score each candidate
  const scored = candidateAgents.map(agent => ({
    agent,
    score: scoreAgentForTask(agent, task),
    reason: getAssignmentReason(agent, task),
  }));
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  const best = scored[0]!;
  const alternatives = scored.slice(1).map(s => ({
    agentId: s.agent.id,
    confidence: s.score,
    reason: s.reason,
  }));
  
  return {
    taskId: task.id,
    agentId: best.agent.id,
    confidence: best.score,
    reason: best.reason,
    alternatives,
  };
}

/**
 * Get candidate agents for a task
 */
function getCandidateAgents(task: Task, availableAgents: AgentProfile[]): AgentProfile[] {
  // Get preferred agent types for this task type
  const preferredTypes = TASK_TYPE_AGENT_MAP[task.type] ?? ["vstack-developer"];
  
  // Get preferred agent types for required skills
  const skillTypes = new Set<string>();
  for (const skill of task.requiredSkills) {
    const types = SKILL_AGENT_MAP[skill] ?? [];
    for (const type of types) skillTypes.add(type);
  }
  
  // Combine and filter available agents
  const allPreferred = new Set([...preferredTypes, ...skillTypes]);
  
  return availableAgents.filter(agent => {
    if (agent.availability !== "available") return false;
    if (agent.currentTasks.length >= agent.maxConcurrentTasks) return false;
    if (allPreferred.size > 0 && !allPreferred.has(agent.type)) return false;
    return true;
  });
}

/**
 * Score an agent for a task (0-1)
 */
function scoreAgentForTask(agent: AgentProfile, task: Task): number {
  let score = 0;
  
  // Base score for matching task type
  const preferredTypes = TASK_TYPE_AGENT_MAP[task.type] ?? [];
  if (preferredTypes.includes(agent.type)) {
    score += 0.4;
  }
  
  // Score for matching skills
  let skillMatches = 0;
  for (const skill of task.requiredSkills) {
    if (agent.skills.includes(skill)) {
      skillMatches++;
    }
  }
  if (task.requiredSkills.length > 0) {
    score += 0.3 * (skillMatches / task.requiredSkills.length);
  }
  
  // Score for availability (lower utilization = higher score)
  const utilization = agent.currentTasks.length / agent.maxConcurrentTasks;
  score += 0.2 * (1 - utilization);
  
  // Score for agent capacity (more capacity = slightly higher score)
  score += 0.1 * (1 - (agent.currentTasks.length / Math.max(agent.maxConcurrentTasks, 1)));
  
  return Math.min(1, score);
}

/**
 * Get human-readable reason for assignment
 */
function getAssignmentReason(agent: AgentProfile, task: Task): string {
  const reasons: string[] = [];
  
  const preferredTypes = TASK_TYPE_AGENT_MAP[task.type] ?? [];
  if (preferredTypes.includes(agent.type)) {
    reasons.push(`specialized for ${task.type} tasks`);
  }
  
  const matchingSkills = task.requiredSkills.filter(s => agent.skills.includes(s));
  if (matchingSkills.length > 0) {
    reasons.push(`has skills: ${matchingSkills.join(", ")}`);
  }
  
  const utilization = Math.round((agent.currentTasks.length / agent.maxConcurrentTasks) * 100);
  reasons.push(`${utilization}% utilized`);
  
  return reasons.join("; ");
}

/**
 * Assign multiple tasks optimally
 */
export function assignTasks(
  tasks: Task[],
  agents: AgentProfile[]
): AssignmentResult[] {
  const results: AssignmentResult[] = [];
  const agentWorkloads = new Map<string, AgentProfile>();
  
  // Initialize workloads
  for (const agent of agents) {
    agentWorkloads.set(agent.id, { ...agent, currentTasks: [...agent.currentTasks] });
  }
  
  // Sort tasks by priority and dependencies (ready tasks first)
  const sortedTasks = [...tasks].sort((a, b) => {
    // Higher priority first
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    const priorityDiff = (priorityOrder[b.priority] ?? 1) - (priorityOrder[a.priority] ?? 1);
    if (priorityDiff !== 0) return priorityDiff;
    
    // Fewer dependencies first (more ready)
    return a.dependencies.length - b.dependencies.length;
  });
  
  for (const task of sortedTasks) {
    // Get available agents considering current workload
    const availableAgents = Array.from(agentWorkloads.values()).filter(a => 
      a.availability === "available" && 
      a.currentTasks.length < a.maxConcurrentTasks
    );
    
    if (availableAgents.length === 0) {
      results.push({
        taskId: task.id,
        agentId: "",
        confidence: 0,
        reason: "No available agents",
        alternatives: [],
      });
      continue;
    }
    
    const assignment = findBestAgent(task, availableAgents);
    
    if (assignment.agentId) {
      // Update agent workload
      const agent = agentWorkloads.get(assignment.agentId);
      if (agent) {
        agent.currentTasks.push(task.id);
      }
    }
    
    results.push(assignment);
  }
  
  return results;
}

/**
 * Get workload report for all agents
 */
export function getWorkloadReport(agents: AgentProfile[]): WorkloadReport[] {
  return agents.map(agent => ({
    agentId: agent.id,
    assignedTasks: agent.currentTasks.length,
    maxConcurrent: agent.maxConcurrentTasks,
    utilization: agent.currentTasks.length / agent.maxConcurrentTasks,
    queuedTasks: [...agent.currentTasks],
  }));
}

/**
 * Rebalance workloads
 */
export function rebalanceWorkload(
  assignments: AssignmentResult[],
  agents: AgentProfile[],
  maxIterations = 10
): AssignmentResult[] {
  let currentAssignments = [...assignments];
  
  for (let i = 0; i < maxIterations; i++) {
    const workloads = getWorkloadReport(agents);
    const overloaded = workloads.filter(w => w.utilization > 0.8);
    const underloaded = workloads.filter(w => w.utilization < 0.3 && w.assignedTasks > 0);
    
    if (overloaded.length === 0 || underloaded.length === 0) break;
    
    // Try to move one task from overloaded to underloaded
    for (const over of overloaded) {
      for (const under of underloaded) {
        // Find a task that could move
        const movableTask = currentAssignments.find(a => 
          a.agentId === over.agentId && 
          assignmentCouldMove(a.taskId, under.agentId, agents)
        );
        
        if (movableTask) {
          movableTask.agentId = under.agentId;
          // Update agent workloads
          const overAgent = agents.find(a => a.id === over.agentId);
          const underAgent = agents.find(a => a.id === under.agentId);
          if (overAgent && underAgent) {
            overAgent.currentTasks = overAgent.currentTasks.filter(t => t !== movableTask.taskId);
            underAgent.currentTasks.push(movableTask.taskId);
          }
          break;
        }
      }
    }
  }
  
  return currentAssignments;
}

function assignmentCouldMove(taskId: string, targetAgentId: string, agents: AgentProfile[]): boolean {
  const targetAgent = agents.find(a => a.id === targetAgentId);
  if (!targetAgent) return false;
  if (targetAgent.currentTasks.length >= targetAgent.maxConcurrentTasks) return false;
  if (targetAgent.availability !== "available") return false;
  return true;
}

/**
 * Check if agent can handle task type
 */
export function canAgentHandleTaskType(agent: AgentProfile, taskType: TaskType): boolean {
  return TASK_TYPE_AGENT_MAP[taskType]?.includes(agent.type) ?? false;
}

/**
 * Get required agent for task type (most specialized)
 */
export function getRequiredAgentForTaskType(taskType: TaskType): string | null {
  const agents = TASK_TYPE_AGENT_MAP[taskType];
  return agents?.[0] ?? null;
}