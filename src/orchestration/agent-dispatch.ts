/**
 * Agent dispatch manager
 * Handles OpenCode session creation, agent assignment, and lifecycle
 */

import { v4 as uuidv4 } from "uuid";
import { AgentRun, AgentRunId, AgentRunStatus, Delivery, Task, agentRunId as createAgentRunId } from "../schemas/types.js";
import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";

export interface AgentDispatchConfig {
  defaultModel: string | null;
  maxSteps: Record<string, number>;
  defaultPermissions: string[];
  enableWorktrees: boolean;
}

export interface DispatchOptions {
  task?: Task;
  delivery: Delivery;
  agentId: string; // vstack-* agent ID
  worktreePath?: string;
  parentSessionId?: string;
  customPrompt?: string;
  contextFiles?: string[];
}

export interface DispatchResult {
  agentRunId: AgentRunId;
  sessionId: string;
  status: "created" | "failed";
  message: string;
}

export interface AgentSessionInfo {
  sessionId: string;
  agentId: string;
  taskId: string | null;
  deliveryId: string;
  status: AgentRunStatus;
  startedAt: string;
  lastActivity: string;
  worktreePath: string | null;
}

export interface AgentRunStoreLike {
  createAgentRun(params: {
    deliveryId: string;
    taskId: string | null;
    agentId: string;
    sessionId: string;
    role: "lead" | "builder" | "reviewer";
    objective: string;
    contextReferences: string[];
    worktreePath: string | null;
  }): Promise<AgentRun>;
  getAgentRun(agentRunId: AgentRunId): Promise<AgentRun | null>;
  updateAgentRun(agentRunId: AgentRunId, updates: {
    status?: AgentRunStatus;
    resultSummary?: string;
    error?: string;
    completedAt?: string;
    handoffSummary?: string;
  }): Promise<AgentRun>;
}

/**
 * Create agent dispatch manager
 */
export async function createAgentDispatch(
  paths: VstackPaths,
  config: AgentDispatchConfig,
  opencodeContext: any, // OpenCode plugin context
  agentRunStore?: AgentRunStoreLike
) {
  const activeSessions = new Map<string, AgentSessionInfo>();
  
  return {
    /**
     * Dispatch a new agent for a task
     */
    async dispatchAgent(options: DispatchOptions): Promise<DispatchResult> {
      const { task, delivery, agentId, worktreePath, parentSessionId, customPrompt, contextFiles } = options;
      
      // Create agent run record
      const agentRunId = createAgentRunId(`agrun_${uuidv4()}`);
      const sessionId = `session_${uuidv4()}`;
      const now = new Date().toISOString();
      
      // Build dispatch prompt
      let prompt = customPrompt;
      if (!prompt && task) {
        prompt = this.buildTaskPrompt(task, delivery);
      }
      
      if (!prompt) {
        throw new Error("Either task or customPrompt must be provided");
      }
      
      // Extract role from agentId
      const role = agentId.replace("vstack-", "") as "lead" | "builder" | "reviewer";
      
      // Use agentRunStore if available, otherwise write directly
      let agentRun: AgentRun;
      
      if (agentRunStore) {
        agentRun = await agentRunStore.createAgentRun({
          deliveryId: delivery.id,
          taskId: task?.id ?? null,
          agentId,
          sessionId,
          role,
          objective: prompt,
          contextReferences: contextFiles ?? [],
          worktreePath: worktreePath ?? null,
        });
      } else {
        agentRun = {
          schemaVersion: 1,
          id: agentRunId,
          deliveryId: delivery.id,
          taskId: task?.id ?? null,
          agentId,
          sessionId,
          worktreePath: worktreePath ?? null,
          status: "dispatched",
          dispatchPrompt: prompt,
          contextReferences: contextFiles ?? [],
          startedAt: now,
          completedAt: null,
          resultSummary: null,
          error: null,
          handoffSummary: null,
          revision: 1,
        };
        
        // Ensure agent-runs directory exists
        const { mkdirSync } = await import("node:fs");
        const agentRunDirPath = resolve(paths.deliveries, delivery.id, "agent-runs");
        mkdirSync(agentRunDirPath, { recursive: true });

        // Save agent run
        const agentRunPath = resolve(paths.deliveries, delivery.id, "agent-runs", `${agentRunId}.json`);
        await writeJsonFile(paths, agentRunPath, agentRun);
      }
      
      // Track active session
      const sessionInfo: AgentSessionInfo = {
        sessionId: agentRun.sessionId,
        agentId,
        taskId: task?.id ?? null,
        deliveryId: delivery.id,
        status: "dispatched",
        startedAt: now,
        lastActivity: now,
        worktreePath: worktreePath ?? null,
      };
      activeSessions.set(sessionId, sessionInfo);
      
      // In real implementation, create OpenCode session:
      // const session = await opencodeContext.session.create({
      //   agentId,
      //   model: config.defaultModel,
      //   worktreePath,
      //   prompt: prompt,
      //   parentSessionId,
      // });
      
      // For now, simulate
      const simulatedSessionId = sessionId;
      
      // Update agent run with session ID
      agentRun.sessionId = simulatedSessionId;
      
      if (agentRunStore) {
        await agentRunStore.updateAgentRun(agentRunId, { status: "running" });
      } else {
        const agentRunPath = resolve(paths.deliveries, delivery.id, "agent-runs", `${agentRunId}.json`);
        await writeJsonFile(paths, agentRunPath, { ...agentRun, sessionId: simulatedSessionId, status: "running" });
      }
      
      // Log event
      await appendEvent(paths, EventPayloads.agentDispatched(delivery.id, agentRunId, agentId, task?.id ?? null));
      
      return {
        agentRunId,
        sessionId: simulatedSessionId,
        status: "created",
        message: `Agent ${agentId} dispatched successfully`,
      };
    },
    
    /**
     * Build task prompt for agent
     */
    buildTaskPrompt(task: Task, delivery: Delivery): string {
      return `# Task: ${task.title}

## Delivery Context
- **Delivery**: ${delivery.title} (${delivery.id})
- **Phase**: ${delivery.currentPhase}
- **Profile**: ${delivery.profile}

## Task Details
- **Type**: ${task.type}
- **Priority**: ${task.priority}
- **Work Scope**: ${task.workScope}

## Description
${task.description}

## Acceptance Criteria
${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

## Expected Outputs
${task.expectedOutputs.map((o, i) => `${i + 1}. ${o}`).join("\n")}

## Required Skills
${task.requiredSkills.map(s => `- ${s}`).join("\n")}

## Instructions
Follow the vstack-${task.type} skill for this task. Use workflow tools to record progress and evidence.
`;
    },
    
    /**
     * Update agent run status
     */
    async updateAgentRunStatus(
      agentRunId: AgentRunId,
      deliveryId: string,
      status: AgentRunStatus,
      resultSummary?: string,
      error?: string
    ): Promise<void> {
      if (agentRunStore) {
        await agentRunStore.updateAgentRun(agentRunId, {
          status,
          completedAt: ["completed", "failed", "cancelled"].includes(status) ? new Date().toISOString() : undefined,
          resultSummary,
          error,
        });
      } else {
        const agentRunPath = resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`);
        const agentRun = await readJsonFile<AgentRun>(paths, agentRunPath);
        
        if (!agentRun) throw new Error(`Agent run ${agentRunId} not found`);
        
        const updated: AgentRun = {
          ...agentRun,
          status,
          completedAt: ["completed", "failed", "cancelled"].includes(status) ? new Date().toISOString() : agentRun.completedAt,
          resultSummary: resultSummary ?? agentRun.resultSummary,
          error: error ?? agentRun.error,
          revision: agentRun.revision + 1,
        };
        
        await writeJsonFile(paths, agentRunPath, updated);
      }
      
      // Update active session
      const agentRun = agentRunStore 
        ? await agentRunStore.getAgentRun(agentRunId)
        : await readJsonFile<AgentRun>(paths, resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`));
      
      if (agentRun && activeSessions.has(agentRun.sessionId)) {
        const info = activeSessions.get(agentRun.sessionId)!;
        info.status = status;
        info.lastActivity = new Date().toISOString();
      }
    },
    
    /**
     * Send prompt to agent session
     */
    async sendPrompt(
      agentRunId: AgentRunId,
      deliveryId: string,
      prompt: string,
      opencodeContext: any
    ): Promise<void> {
      // In real implementation:
      // await opencodeContext.session.prompt({
      //   sessionId: agentRun.sessionId,
      //   prompt: prompt,
      // });
      
      // Update last activity
      const agentRun = agentRunStore 
        ? await agentRunStore.getAgentRun(agentRunId)
        : await readJsonFile<AgentRun>(paths, resolve(paths.deliveries, deliveryId, "agent-runs", `${agentRunId}.json`));
      
      if (agentRun && activeSessions.has(agentRun.sessionId)) {
        activeSessions.get(agentRun.sessionId)!.lastActivity = new Date().toISOString();
      }
    },
    
    /**
     * Interrupt agent session
     */
    async interruptAgent(
      agentRunId: AgentRunId,
      deliveryId: string,
      opencodeContext: any
    ): Promise<void> {
      await this.updateAgentRunStatus(agentRunId, deliveryId, "cancelled", undefined, "Interrupted by orchestrator");
    },
    
    /**
     * Get agent session info
     */
    getSessionInfo(sessionId: string): AgentSessionInfo | null {
      return activeSessions.get(sessionId) ?? null;
    },
    
    /**
     * Get all active sessions
     */
    getActiveSessions(): AgentSessionInfo[] {
      return Array.from(activeSessions.values());
    },
    
    /**
     * Get sessions for a delivery
     */
    getDeliverySessions(deliveryId: string): AgentSessionInfo[] {
      return Array.from(activeSessions.values()).filter(s => s.deliveryId === deliveryId);
    },
    
    /**
     * Check if session is still active
     */
    async isSessionActive(sessionId: string, opencodeContext: any): Promise<boolean> {
      // In real implementation:
      // const session = await opencodeContext.session.get({ sessionId });
      // return session.status === "active" || session.status === "running";
      
      // For now, check local tracking
      const info = activeSessions.get(sessionId);
      if (!info) return false;
      
      // Consider inactive if no activity for 10 minutes
      const lastActivity = new Date(info.lastActivity).getTime();
      const now = Date.now();
      return (now - lastActivity) < 10 * 60 * 1000;
    },
    
    /**
     * Clean up completed sessions
     */
    cleanupCompletedSessions(): void {
      for (const [sessionId, info] of activeSessions) {
        if (["completed", "failed", "cancelled"].includes(info.status)) {
          activeSessions.delete(sessionId);
        }
      }
    },
  };
}

/**
 * Default agent dispatch configuration
 */
export const DEFAULT_AGENT_DISPATCH_CONFIG: AgentDispatchConfig = {
  defaultModel: null, // Use session default
  maxSteps: {
    "vstack-lead": 50,
    "vstack-builder": 40,
    "vstack-reviewer": 30,
  },
  defaultPermissions: [],
  enableWorktrees: false,
};