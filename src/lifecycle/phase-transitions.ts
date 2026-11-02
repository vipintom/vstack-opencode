/**
 * Phase transition validation and execution
 * Enforces valid state transitions and gate requirements
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { 
  Delivery, 
  PhaseRun, 
  DeliveryPhase, 
  PhaseRunStatus, 
  DeliveryStatus,
  EvidenceType,
  EventType,
  ProfileId,
  DeliveryId,
  PhaseRunId,
  deliveryId,
  phaseRunId
} from "../schemas/types.js";
import { readJsonFile, writeJsonFile, listFiles } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { getProfile, getNextPhase, getRequiredGates, isApprovalRequired, getApprovalType, canSkipPhase } from "./profiles.js";
import { resolve } from "node:path";

export interface TransitionResult {
  success: boolean;
  message: string;
  newPhase?: DeliveryPhase;
  newPhaseRunId?: string;
  requiredGates?: EvidenceType[];
  missingGates?: EvidenceType[];
  approvalRequired?: boolean;
  approvalType?: string;
}

export interface PhaseTransitionContext {
  delivery: Delivery;
  currentPhaseRun: PhaseRun | null;
  profileId: ProfileId;
  actorId: string;
  actorType: "plugin" | "agent" | "human";
  sessionId?: string;
  toolId?: string;
}

/**
 * Valid phase transitions (from -> allowed to)
 */
const VALID_PHASE_TRANSITIONS: Record<DeliveryPhase, DeliveryPhase[]> = {
  intake: ["discovery", "design", "planning", "implementation"],
  discovery: ["design", "planning", "implementation", "intake"],
  design: ["planning", "implementation", "discovery", "release_preparation"],
  planning: ["implementation", "design", "discovery"],
  implementation: ["validation", "planning", "design"],
  validation: ["review", "implementation", "planning"],
  review: ["release_preparation", "validation", "implementation", "deployment"],
  release_preparation: ["deployment", "validation", "review", "post_release"],
  deployment: ["post_release", "release_preparation", "review"],
  post_release: ["completed", "deployment", "release_preparation"],
  completed: [],
};

/**
 * Validate if a phase transition is allowed
 */
export function canTransitionPhase(fromPhase: DeliveryPhase, toPhase: DeliveryPhase): boolean {
  return VALID_PHASE_TRANSITIONS[fromPhase]?.includes(toPhase) ?? false;
}

/**
 * Check if all required gates for a phase are satisfied
 */
export async function checkPhaseGates(
  paths: VstackPaths,
  deliveryId: DeliveryId,
  phaseRunId: PhaseRunId,
  profileId: ProfileId
): Promise<{ satisfied: boolean; missingGates: EvidenceType[] }> {
  const profile = getProfile(profileId);
  const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
  const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
  
  if (!phaseRun) {
    return { satisfied: false, missingGates: ["other"] as EvidenceType[] };
  }
  
  const requiredGates = getRequiredGates(profileId, phaseRun.phase);
  const missingGates: EvidenceType[] = [];
  
  for (const gateId of requiredGates) {
    const gateResult = phaseRun.gateResults.find(gr => gr.gateId === gateId);
    if (!gateResult || gateResult.status !== "passed") {
      missingGates.push(gateId);
    }
  }
  
  return { satisfied: missingGates.length === 0, missingGates };
}

/**
 * Request a phase transition
 */
export async function requestPhaseTransition(
  paths: VstackPaths,
  context: PhaseTransitionContext,
  targetPhase: DeliveryPhase,
  options: { skipGates?: boolean; skipApproval?: boolean; skipReason?: string } = {}
): Promise<TransitionResult> {
  const { delivery, currentPhaseRun, profileId, actorId, actorType, sessionId, toolId } = context;
  
  // Validate transition
  if (!canTransitionPhase(delivery.currentPhase, targetPhase)) {
    return {
      success: false,
      message: `Invalid phase transition: ${delivery.currentPhase} -> ${targetPhase}`,
    };
  }
  
  // Check if skipping a required phase
  if (targetPhase !== getNextPhase(profileId, delivery.currentPhase)) {
    const profile = getProfile(profileId);
    const skippedPhases = profile.phases
      .slice(
        profile.phases.findIndex(p => p.phase === delivery.currentPhase) + 1,
        profile.phases.findIndex(p => p.phase === targetPhase)
      )
      .filter(p => p.required);
    
    if (skippedPhases.length > 0 && !options.skipGates) {
      return {
        success: false,
        message: `Cannot skip required phases: ${skippedPhases.map(p => p.phase).join(", ")}. Use skipGates option with reason.`,
        requiredGates: skippedPhases.flatMap(p => p.requiredGates),
      };
    }
  }
  
  // Check gates for current phase (if not skipping)
  if (!options.skipGates && currentPhaseRun) {
    const { satisfied, missingGates } = await checkPhaseGates(paths, delivery.id, currentPhaseRun.id, profileId);
    if (!satisfied) {
      return {
        success: false,
        message: `Required gates not satisfied for phase ${delivery.currentPhase}: ${missingGates.join(", ")}`,
        requiredGates: getRequiredGates(profileId, delivery.currentPhase),
        missingGates,
      };
    }
  }
  
  // Check approval requirement
  const targetPhaseReq = getProfile(profileId).phases.find(p => p.phase === targetPhase);
  if (targetPhaseReq?.approvalRequired && !options.skipApproval) {
    return {
      success: false,
      message: `Approval required for phase ${targetPhase}`,
      approvalRequired: true,
      approvalType: targetPhaseReq.approvalType,
      newPhase: targetPhase,
    };
  }
  
  // Check if phase can be skipped
  if (targetPhase !== getNextPhase(profileId, delivery.currentPhase)) {
    if (!canSkipPhase(profileId, targetPhase)) {
      return {
        success: false,
        message: `Phase ${targetPhase} cannot be skipped in profile ${profileId}`,
      };
    }
    
    if (!options.skipReason) {
      return {
        success: false,
        message: `Skip reason required for phase ${targetPhase}`,
      };
    }
  }
  
  // Execute transition
  return await executePhaseTransition(paths, context, targetPhase, options);
}

/**
 * Execute a validated phase transition
 */
async function executePhaseTransition(
  paths: VstackPaths,
  context: PhaseTransitionContext,
  targetPhase: DeliveryPhase,
  options: { skipReason?: string; skipGates?: boolean }
): Promise<TransitionResult> {
  const { delivery, currentPhaseRun, profileId, actorId, actorType, sessionId, toolId } = context;
  
  // Create new phase run
  const profile = getProfile(profileId);
  const targetPhaseReq = profile.phases.find(p => p.phase === targetPhase);
  const runSequence = (currentPhaseRun?.runSequence ?? 0) + 1;
  
  const newPhaseRun: PhaseRun = {
    schemaVersion: 1,
    id: phaseRunId(`phrun_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`),
    deliveryId: delivery.id,
    phase: targetPhase,
    runSequence,
    status: "not_started",
    startedAt: null,
    completedAt: null,
    blockedAt: null,
    blockedReason: null,
    approvalRequired: targetPhaseReq?.approvalRequired ?? false,
    approvalId: null,
    gateResults: [],
    requiredGates: targetPhaseReq?.requiredGates ?? [],
    optionalGates: targetPhaseReq?.optionalGates ?? [],
    skipReason: options.skipReason ?? null,
    skipBy: options.skipReason ? actorId : null,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  // Write new phase run
  const phaseRunPath = resolve(paths.deliveries, delivery.id, "phases", `${newPhaseRun.id}.json`);
  await writeJsonFile(paths, phaseRunPath, newPhaseRun);
  
  // Complete current phase run if exists
  if (currentPhaseRun) {
    const completedPhaseRun = {
      ...currentPhaseRun,
      status: options.skipReason ? ("skipped" as PhaseRunStatus) : ("completed" as PhaseRunStatus),
      completedAt: new Date().toISOString(),
      skipReason: options.skipReason ?? currentPhaseRun.skipReason,
      skipBy: options.skipReason ? actorId : currentPhaseRun.skipBy,
      revision: currentPhaseRun.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(paths, phaseRunPath.replace(newPhaseRun.id, currentPhaseRun.id), completedPhaseRun);
  }
  
  // Update delivery
  const updatedDelivery: Delivery = {
    ...delivery,
    currentPhase: targetPhase,
    currentPhaseRunId: newPhaseRun.id,
    status: targetPhase === "completed" ? "completed" : "active",
    updatedAt: new Date().toISOString(),
    revision: delivery.revision + 1,
  };
  
  const deliveryPath = resolve(paths.deliveries, delivery.id, "delivery.json");
  await writeJsonFile(paths, deliveryPath, updatedDelivery);
  
  // Log event
  await appendEvent(paths, {
    ...EventPayloads.phaseAdvanced(delivery.id, currentPhaseRun?.id ?? "", newPhaseRun.id, delivery.currentPhase, targetPhase),
    actor: { type: actorType, id: actorId },
    source: { sessionId: sessionId ?? null, toolId: toolId ?? null },
  });
  
  return {
    success: true,
    message: `Transitioned to ${targetPhase}`,
    newPhase: targetPhase,
    newPhaseRunId: newPhaseRun.id,
  };
}

/**
 * Start a phase (mark as active)
 */
export async function startPhase(
  paths: VstackPaths,
  deliveryId: DeliveryId,
  phaseRunId: PhaseRunId,
  actorId: string,
  actorType: "plugin" | "agent" | "human",
  sessionId?: string,
  toolId?: string
): Promise<TransitionResult> {
  const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
  const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
  
  if (!phaseRun) {
    return { success: false, message: "Phase run not found" };
  }
  
  if (phaseRun.status !== "not_started" && phaseRun.status !== "ready") {
    return { success: false, message: `Cannot start phase in status: ${phaseRun.status}` };
  }
  
  const updatedPhaseRun = {
    ...phaseRun,
    status: "active" as PhaseRunStatus,
    startedAt: new Date().toISOString(),
    revision: phaseRun.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  
  await writeJsonFile(paths, phaseRunPath, updatedPhaseRun);
  
  // Update delivery if this is the current phase
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  
  if (delivery && delivery.currentPhaseRunId === phaseRunId) {
    const updatedDelivery = {
      ...delivery,
      status: "active" as DeliveryStatus,
      updatedAt: new Date().toISOString(),
      revision: delivery.revision + 1,
    };
    await writeJsonFile(paths, deliveryPath, updatedDelivery);
  }
  
  await appendEvent(paths, {
    ...EventPayloads.phaseEntered(deliveryId, phaseRunId, phaseRun.phase),
    actor: { type: actorType, id: actorId },
    source: { sessionId: sessionId ?? null, toolId: toolId ?? null },
  });
  
  return { success: true, message: `Started phase ${phaseRun.phase}` };
}

/**
 * Block a phase
 */
export async function blockPhase(
  paths: VstackPaths,
  deliveryId: DeliveryId,
  phaseRunId: PhaseRunId,
  reason: string,
  actorId: string,
  actorType: "plugin" | "agent" | "human",
  sessionId?: string,
  toolId?: string
): Promise<TransitionResult> {
  const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
  const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
  
  if (!phaseRun) {
    return { success: false, message: "Phase run not found" };
  }
  
  if (phaseRun.status === "completed" || phaseRun.status === "skipped" || phaseRun.status === "cancelled") {
    return { success: false, message: `Cannot block phase in status: ${phaseRun.status}` };
  }
  
  const updatedPhaseRun = {
    ...phaseRun,
    status: "blocked" as PhaseRunStatus,
    blockedAt: new Date().toISOString(),
    blockedReason: reason,
    revision: phaseRun.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  
  await writeJsonFile(paths, phaseRunPath, updatedPhaseRun);
  
  // Update delivery status
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  
  if (delivery && delivery.currentPhaseRunId === phaseRunId) {
    const updatedDelivery = {
      ...delivery,
      status: "blocked" as DeliveryStatus,
      updatedAt: new Date().toISOString(),
      revision: delivery.revision + 1,
    };
    await writeJsonFile(paths, deliveryPath, updatedDelivery);
  }
  
  await appendEvent(paths, {
    ...EventPayloads.phaseEntered(deliveryId, phaseRunId, phaseRun.phase, { type: actorType, id: actorId }, { type: "phase", id: phaseRunId }, { sessionId: sessionId ?? null, toolId: toolId ?? null }),
    eventType: "phase_blocked",
    payload: { phaseRunId, reason, phase: phaseRun.phase },
  });
  
  return { success: true, message: `Phase blocked: ${reason}` };
}

/**
 * Unblock a phase
 */
export async function unblockPhase(
  paths: VstackPaths,
  deliveryId: DeliveryId,
  phaseRunId: PhaseRunId,
  actorId: string,
  actorType: "plugin" | "agent" | "human",
  sessionId?: string,
  toolId?: string
): Promise<TransitionResult> {
  const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
  const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
  
  if (!phaseRun) {
    return { success: false, message: "Phase run not found" };
  }
  
  if (phaseRun.status !== "blocked") {
    return { success: false, message: `Phase not blocked, current status: ${phaseRun.status}` };
  }
  
  const previousStatus = phaseRun.startedAt ? "active" : "ready";
  
  const updatedPhaseRun = {
    ...phaseRun,
    status: previousStatus as PhaseRunStatus,
    blockedAt: null,
    blockedReason: null,
    revision: phaseRun.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  
  await writeJsonFile(paths, phaseRunPath, updatedPhaseRun);
  
  // Update delivery status
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  
  if (delivery && delivery.currentPhaseRunId === phaseRunId) {
    const updatedDelivery = {
      ...delivery,
      status: "active" as DeliveryStatus,
      updatedAt: new Date().toISOString(),
      revision: delivery.revision + 1,
    };
    await writeJsonFile(paths, deliveryPath, updatedDelivery);
  }
  
  await appendEvent(paths, {
    ...EventPayloads.phaseEntered(deliveryId, phaseRunId, phaseRun.phase, { type: actorType, id: actorId }, { type: "phase", id: phaseRunId }, { sessionId: sessionId ?? null, toolId: toolId ?? null }),
    eventType: "phase_advanced",
    payload: { phaseRunId, phase: phaseRun.phase, action: "unblocked" },
  });
  
  return { success: true, message: `Phase unblocked, resumed to ${previousStatus}` };
}

/**
 * Get valid next phases for current phase in profile
 */
export function getValidNextPhases(profileId: ProfileId, currentPhase: DeliveryPhase): DeliveryPhase[] {
  return VALID_PHASE_TRANSITIONS[currentPhase] ?? [];
}