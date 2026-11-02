/**
 * Append-only event log for vstack workflow state
 * Provides durable audit trail of all state transitions
 */

import { VstackPaths, validateVstackPath, ensureVstackDirs } from "./repository-root.js";
import { Event, EventId, eventId } from "../schemas/types.js";
export type { Event, EventId, eventId } from "../schemas/types.js";
import { v4 as uuidv4 } from "uuid";

let eventSequence = 0;
let sequenceInitialized = false;

/**
 * Initialize event sequence from existing log
 */
export async function initializeEventLog(paths: VstackPaths): Promise<void> {
  if (sequenceInitialized) return;
  
  const eventsPath = paths.events!;
  
  const fs = await import("node:fs");
  if (!eventsPath || !fs.existsSync(eventsPath)) {
    eventSequence = 0;
    sequenceInitialized = true;
    return;
  }
  
  try {
    const content = fs.readFileSync(eventsPath!, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      if (lastLine) {
        const lastEvent = JSON.parse(lastLine) as Event;
        eventSequence = lastEvent.sequence || 0;
      }
    }
  } catch {
    eventSequence = 0;
  }
  
  sequenceInitialized = true;
}

/**
 * Get next event sequence number
 */
function getNextSequence(): number {
  return ++eventSequence;
}

/**
 * Append an event to the log
 */
export async function appendEvent(
  paths: VstackPaths,
  event: Omit<Event, "eventId" | "sequence" | "schemaVersion"> & { schemaVersion?: number }
): Promise<Event> {
  await initializeEventLog(paths);
  await ensureVstackDirs(paths);
  
  const { schemaVersion: _, timestamp: __, ...eventData } = event;
  const fullEvent: Event = {
    schemaVersion: 1,
    eventId: eventId(uuidv4()),
    sequence: getNextSequence(),
    timestamp: new Date().toISOString(),
    ...eventData,
  };
  
  const fs = await import("node:fs");
  const line = JSON.stringify(fullEvent) + "\n";
  
  // Append to file (atomic on POSIX for single writes)
  if (paths.events) {
    fs.appendFileSync(paths.events, line, "utf-8");
  }
  
  return fullEvent;
}

/**
 * Read events from the log (with optional filtering)
 */
export async function readEvents(
  paths: VstackPaths,
  options: {
    deliveryId?: string;
    entityType?: Event["entity"]["type"];
    entityId?: string;
    eventType?: Event["eventType"];
    fromSequence?: number;
    toSequence?: number;
    limit?: number;
    reverse?: boolean;
  } = {}
): Promise<Event[]> {
  await initializeEventLog(paths);
  
  const eventsPath = paths.events!;
  const fs = await import("node:fs");
  
  if (!fs.existsSync(eventsPath)) {
    return [];
  }
  
  const content = fs.readFileSync(eventsPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  
  let events = lines.map(line => JSON.parse(line) as Event);
  
  // Apply filters
  if (options.deliveryId) {
    events = events.filter(e => e.deliveryId === options.deliveryId);
  }
  if (options.entityType) {
    events = events.filter(e => e.entity.type === options.entityType);
  }
  if (options.entityId) {
    events = events.filter(e => e.entity.id === options.entityId);
  }
  if (options.eventType) {
    events = events.filter(e => e.eventType === options.eventType);
  }
  if (options.fromSequence !== undefined) {
    events = events.filter(e => e.sequence >= options.fromSequence!);
  }
  if (options.toSequence !== undefined) {
    events = events.filter(e => e.sequence <= options.toSequence!);
  }
  
  // Sort by sequence
  if (options.reverse) {
    events.reverse();
  }
  
  // Apply limit
  if (options.limit && options.limit > 0) {
    events = events.slice(0, options.limit);
  }
  
  return events;
}

/**
 * Get event log statistics
 */
export async function getEventLogStats(paths: VstackPaths): Promise<{
  totalEvents: number;
  firstEvent: Event | null;
  lastEvent: Event | null;
  fileSize: number;
}> {
  await initializeEventLog(paths);
  
  const eventsPath = paths.events!;
  const fs = await import("node:fs");
  
  if (!fs.existsSync(eventsPath)) {
    return { totalEvents: 0, firstEvent: null, lastEvent: null, fileSize: 0 };
  }
  
  const stats = fs.statSync(eventsPath);
  const content = fs.readFileSync(eventsPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  
  let firstEvent: Event | null = null;
  let lastEvent: Event | null = null;
  
  if (lines.length > 0) {
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];
    if (firstLine) firstEvent = JSON.parse(firstLine);
    if (lastLine) lastEvent = JSON.parse(lastLine);
  }
  
  return {
    totalEvents: lines.length,
    firstEvent,
    lastEvent,
    fileSize: stats.size,
  };
}

/**
 * Create standard event payloads for common operations
 */
export const EventPayloads = {
  deliveryCreated: (deliveryId: string, title: string, profile: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "delivery", id: deliveryId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "delivery_created" as const,
    payload: { deliveryId, title, profile },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  deliveryUpdated: (deliveryId: string, changes: Record<string, unknown>, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "delivery", id: deliveryId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "delivery_updated" as const,
    payload: { deliveryId, changes },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  phaseEntered: (deliveryId: string, phaseRunId: string, phase: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "phase", id: phaseRunId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "phase_entered" as const,
    payload: { deliveryId, phaseRunId, phase },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  phaseAdvanced: (deliveryId: string, fromPhaseRunId: string, toPhaseRunId: string, fromPhase: string, toPhase: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "phase", id: toPhaseRunId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "phase_advanced" as const,
    payload: { deliveryId, fromPhaseRunId, toPhaseRunId, fromPhase, toPhase },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  taskCreated: (deliveryId: string, taskId: string, title: string, phaseRunId: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "task", id: taskId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "task_created" as const,
    payload: { deliveryId, taskId, title, phaseRunId },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  taskAssigned: (deliveryId: string, taskId: string, agentId: string, sessionId: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "task", id: taskId }, source: Event["source"] = { sessionId, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "task_assigned" as const,
    payload: { deliveryId, taskId, agentId, sessionId },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  taskCompleted: (deliveryId: string, taskId: string, evidenceIds: string[], actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "task", id: taskId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "task_completed" as const,
    payload: { deliveryId, taskId, evidenceIds },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  agentDispatched: (deliveryId: string, agentRunId: string, agentId: string, taskId: string | null, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "agent_run", id: agentRunId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "agent_dispatched" as const,
    payload: { deliveryId, agentRunId, agentId, taskId },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  checkCompleted: (deliveryId: string, evidenceId: string, checkId: string, status: "passed" | "failed" | "timeout" | "error" | "cancelled", actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "evidence", id: evidenceId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "check_completed" as const,
    payload: { deliveryId, evidenceId, checkId, status },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  reviewStarted: (deliveryId: string, reviewRunId: string, profile: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "review", id: reviewRunId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "review_started" as const,
    payload: { deliveryId, reviewRunId, profile },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  findingOpened: (deliveryId: string, findingId: string, severity: string, lens: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "finding", id: findingId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "finding_opened" as const,
    payload: { deliveryId, findingId, severity, lens },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  approvalRequested: (deliveryId: string, approvalId: string, type: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "approval", id: approvalId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "approval_requested" as const,
    payload: { deliveryId, approvalId, type },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  approvalGranted: (deliveryId: string, approvalId: string, decidedBy: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "approval", id: approvalId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "approval_granted" as const,
    payload: { deliveryId, approvalId, decidedBy },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
  
  approvalRejected: (deliveryId: string, approvalId: string, decidedBy: string, actor: Event["actor"] = { type: "plugin", id: "system" }, entity: Event["entity"] = { type: "approval", id: approvalId }, source: Event["source"] = { sessionId: null, toolId: null }) => ({
    deliveryId: deliveryId as any,
    eventType: "approval_rejected" as const,
    payload: { deliveryId, approvalId, decidedBy },
    actor,
    entity,
    source,
    timestamp: new Date().toISOString(),
  }),
};