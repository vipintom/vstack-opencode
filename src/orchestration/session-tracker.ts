/**
 * Session tracker
 * Monitors OpenCode sessions and tracks their lifecycle
 */

import { AgentRun, AgentRunId, TaskId, Delivery } from "../schemas/types.js";
import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles } from "../persistence/file-store.js";
import { appendEvent } from "../persistence/event-log.js";
import { resolve } from "node:path";

export interface SessionInfo {
  sessionId: string;
  agentRunId: AgentRunId;
  taskId: TaskId | null;
  deliveryId: string;
  agentId: string;
  status: "created" | "active" | "completed" | "failed" | "cancelled" | "unknown";
  startedAt: string;
  lastActivity: string;
  worktreePath: string | null;
  messageCount: number;
  toolCalls: number;
}

export interface SessionEvent {
  sessionId: string;
  type: "started" | "prompt_sent" | "tool_called" | "tool_completed" | "completed" | "failed" | "cancelled" | "interrupted" | "message_received";
  timestamp: string;
  details: Record<string, unknown>;
}

export interface SessionSummary {
  sessionId: string;
  agentRunId: AgentRunId;
  deliveryId: string;
  taskId: TaskId | null;
  agentId: string;
  duration: number; // ms
  messageCount: number;
  toolCalls: number;
  status: string;
  outcome: "success" | "failure" | "cancelled" | "timeout";
}

/**
 * Create session tracker
 */
export interface SessionTracker {
  registerSession(
    sessionId: string,
    agentRunId: AgentRunId,
    taskId: TaskId | null,
    deliveryId: string,
    agentId: string,
    worktreePath: string | null
  ): SessionInfo;
  updateSessionStatus(
    sessionId: string,
    status: SessionInfo["status"]
  ): SessionInfo | null;
  recordActivity(
    sessionId: string,
    type: "prompt_sent" | "tool_called" | "tool_completed" | "message_received"
  ): void;
  recordEvent(
    sessionId: string,
    type: SessionEvent["type"],
    details: Record<string, unknown>
  ): void;
  getSession(sessionId: string): SessionInfo | null;
  getActiveSessions(): SessionInfo[];
  getDeliverySessions(deliveryId: string): SessionInfo[];
  getAgentRunSessions(agentRunId: AgentRunId): SessionInfo[];
  completeSession(
    sessionId: string,
    outcome: "success" | "failure" | "cancelled" | "timeout"
  ): Promise<SessionSummary | null>;
  checkStaleSessions(maxInactivityMs?: number): SessionInfo[];
  handleStaleSessions(maxInactivityMs?: number): Promise<void>;
  cleanupOldSessions(maxAgeMs?: number): number;
  getSessionEvents(sessionId: string, limit?: number): SessionEvent[];
  getAllEvents(limit?: number): SessionEvent[];
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    failedSessions: number;
    avgDuration: number;
    avgMessages: number;
    avgToolCalls: number;
  };
}

export async function createSessionTracker(paths: VstackPaths): Promise<SessionTracker> {
  const sessions = new Map<string, SessionInfo>();
  const sessionEvents: SessionEvent[] = [];
  const MAX_EVENTS = 1000;
  
  const tracker: SessionTracker = {
    /**
     * Register a new session
     */
    registerSession(
      sessionId: string,
      agentRunId: AgentRunId,
      taskId: TaskId | null,
      deliveryId: string,
      agentId: string,
      worktreePath: string | null
    ): SessionInfo {
      const now = new Date().toISOString();
      
      const sessionInfo: SessionInfo = {
        sessionId,
        agentRunId,
        taskId,
        deliveryId,
        agentId,
        status: "created",
        startedAt: now,
        lastActivity: now,
        worktreePath,
        messageCount: 0,
        toolCalls: 0,
      };
      
      sessions.set(sessionId, sessionInfo);
      
      return sessionInfo;
    },
    
    /**
     * Update session status
     */
    updateSessionStatus(
      sessionId: string,
      status: SessionInfo["status"]
    ): SessionInfo | null {
      const session = sessions.get(sessionId);
      if (!session) return null;
      
      session.status = status;
      session.lastActivity = new Date().toISOString();
      
      return session;
    },
    
    /**
     * Record session activity
     */
    recordActivity(
      sessionId: string,
      type: "prompt_sent" | "tool_called" | "tool_completed" | "message_received"
    ): void {
      const session = sessions.get(sessionId);
      if (!session) return;
      
      session.lastActivity = new Date().toISOString();
      
      if (type === "tool_called") session.toolCalls++;
      if (type === "message_received") session.messageCount++;
      
      // Record event
      this.recordEvent(sessionId, type, {});
    },
    
    /**
     * Record session event
     */
    recordEvent(
      sessionId: string,
      type: SessionEvent["type"],
      details: Record<string, unknown>
    ): void {
      const event: SessionEvent = {
        sessionId,
        type,
        timestamp: new Date().toISOString(),
        details,
      };
      
      sessionEvents.push(event);
      
      // Trim events if too many
      if (sessionEvents.length > MAX_EVENTS) {
        sessionEvents.shift();
      }
    },
    
    /**
     * Get session info
     */
    getSession(sessionId: string): SessionInfo | null {
      return sessions.get(sessionId) ?? null;
    },
    
    /**
     * Get all active sessions
     */
    getActiveSessions(): SessionInfo[] {
      return Array.from(sessions.values()).filter(s => 
        s.status === "active" || s.status === "created"
      );
    },
    
    /**
     * Get sessions for a delivery
     */
    getDeliverySessions(deliveryId: string): SessionInfo[] {
      return Array.from(sessions.values()).filter(s => s.deliveryId === deliveryId);
    },
    
    /**
     * Get sessions for an agent run
     */
    getAgentRunSessions(agentRunId: AgentRunId): SessionInfo[] {
      return Array.from(sessions.values()).filter(s => s.agentRunId === agentRunId);
    },
    
    /**
     * Get session events
     */
    getSessionEvents(sessionId: string, limit = 50): SessionEvent[] {
      return sessionEvents
        .filter(e => e.sessionId === sessionId)
        .slice(-limit);
    },
    
    /**
     * Get all session events
     */
    getAllEvents(limit = 100): SessionEvent[] {
      return sessionEvents.slice(-limit);
    },
    
    /**
     * Complete a session
     */
    async completeSession(
      sessionId: string,
      outcome: "success" | "failure" | "cancelled" | "timeout"
    ): Promise<SessionSummary | null> {
      const session = sessions.get(sessionId);
      if (!session) return null;
      
      session.status = outcome === "success" ? "completed" : "failed";
      session.lastActivity = new Date().toISOString();
      
      const duration = Date.now() - new Date(session.startedAt).getTime();
      
      const summary: SessionSummary = {
        sessionId,
        agentRunId: session.agentRunId,
        deliveryId: session.deliveryId,
        taskId: session.taskId,
        agentId: session.agentId,
        duration,
        messageCount: session.messageCount,
        toolCalls: session.toolCalls,
        status: session.status,
        outcome,
      };
      
      // Record event
      this.recordEvent(sessionId, outcome === "success" ? "completed" : "failed", { outcome });
      
      return summary;
    },
    
    /**
     * Check for stale sessions
     */
    checkStaleSessions(maxInactivityMs = 10 * 60 * 1000): SessionInfo[] {
      const now = Date.now();
      const stale: SessionInfo[] = [];
      
      for (const session of sessions.values()) {
        if (session.status === "active" || session.status === "created") {
          const lastActivity = new Date(session.lastActivity).getTime();
          if (now - lastActivity > maxInactivityMs) {
            stale.push(session);
          }
        }
      }
      
      return stale;
    },
    
    /**
     * Handle stale sessions
     */
    async handleStaleSessions(maxInactivityMs = 10 * 60 * 1000): Promise<void> {
      const stale = this.checkStaleSessions(maxInactivityMs);
      
      for (const session of stale) {
        // Mark as failed due to timeout
        await this.completeSession(session.sessionId, "timeout");
        
        // Update agent run if exists
        if (session.agentRunId) {
          // Would update agent run in persistence
        }
      }
    },
    
    /**
     * Get session statistics
     */
    getStats(): {
      totalSessions: number;
      activeSessions: number;
      completedSessions: number;
      failedSessions: number;
      avgDuration: number;
      avgMessages: number;
      avgToolCalls: number;
    } {
      const allSessions = Array.from(sessions.values());
      const completed = allSessions.filter(s => s.status === "completed");
      const failed = allSessions.filter(s => s.status === "failed");
      
      const durations = completed.map(s => {
        // Would need end time - for now estimate
        return 0;
      });
      
      return {
        totalSessions: allSessions.length,
        activeSessions: allSessions.filter(s => s.status === "active" || s.status === "created").length,
        completedSessions: completed.length,
        failedSessions: failed.length,
        avgDuration: 0,
        avgMessages: allSessions.reduce((sum, s) => sum + s.messageCount, 0) / Math.max(allSessions.length, 1),
        avgToolCalls: allSessions.reduce((sum, s) => sum + s.toolCalls, 0) / Math.max(allSessions.length, 1),
      };
    },
    
    /**
     * Clean up old sessions
     */
    cleanupOldSessions(maxAgeMs = 24 * 60 * 60 * 1000): number {
      const now = Date.now();
      let cleaned = 0;
      
      for (const [sessionId, session] of sessions) {
        const startedAt = new Date(session.startedAt).getTime();
        if (now - startedAt > maxAgeMs && session.status !== "active") {
          sessions.delete(sessionId);
          cleaned++;
        }
      }
      
      return cleaned;
    },
  };
  return tracker;
}

/**
 * Session tracker with OpenCode integration
 */
export interface OpenCodeSessionTracker {
  trackSession(sessionId: string, agentRunId: AgentRunId): void;
  onPrompt(sessionId: string, prompt: string): void;
  onToolCall(sessionId: string, toolName: string, args: unknown): void;
  onToolResult(sessionId: string, toolName: string, result: unknown): void;
  onComplete(sessionId: string, outcome: "success" | "failure"): void;
}

/**
 * Create OpenCode-integrated session tracker
 */
export function createOpenCodeSessionTracker(
  baseTracker: SessionTracker
): OpenCodeSessionTracker {
  return {
    trackSession(sessionId, agentRunId) {
      // Session already registered via base tracker
    },
    
    onPrompt(sessionId, prompt) {
      baseTracker.recordActivity(sessionId, "prompt_sent");
    },
    
    onToolCall(sessionId, toolName, args) {
      baseTracker.recordActivity(sessionId, "tool_called");
    },
    
    onToolResult(sessionId, toolName, result) {
      baseTracker.recordActivity(sessionId, "tool_completed");
    },
    
    onComplete(sessionId, outcome) {
      baseTracker.completeSession(sessionId, outcome === "success" ? "success" : "failure");
    },
  };
}