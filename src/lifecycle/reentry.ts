/**
 * Phase re-entry handling
 * Allows returning to earlier phases when requirements change
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { 
  Delivery, 
  PhaseRun, 
  DeliveryPhase, 
  PhaseRunStatus,
  DeliveryId,
  PhaseRunId,
  deliveryId,
  phaseRunId
} from "../schemas/types.js";
import { getProfile, getNextPhase } from "./profiles.js";
import { writeJsonFile, readJsonFile } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";

export interface ReentryResult {
  success: boolean;
  delivery: Delivery;
  newPhaseRun: PhaseRun;
  message: string;
  reenteredFrom: DeliveryPhase;
}

export interface ReentryContext {
  delivery: Delivery;
  currentPhaseRun: PhaseRun;
  targetPhase: DeliveryPhase;
  reason: string;
  actor: { type: "plugin" | "agent" | "human"; id: string };
}

/**
 * Re-enter a previous phase
 * Creates a new phase run for the target phase with incremented runSequence
 */
export async function reenterPhase(
  paths: VstackPaths,
  context: ReentryContext
): Promise<ReentryResult> {
  const { delivery, currentPhaseRun, targetPhase, reason, actor } = context;
  const profile = getProfile(delivery.profile);
  
  // Validate target phase exists in profile
  const targetPhaseReq = profile.phases.find(p => p.phase === targetPhase);
  if (!targetPhaseReq) {
    return {
      success: false,
      delivery,
      newPhaseRun: null as any,
      message: `Target phase ${targetPhase} not found in profile ${delivery.profile}`,
      reenteredFrom: delivery.currentPhase,
    };
  }
  
  // Validate target phase is before or equal to current phase
  const profilePhases = profile.phases.map(p => p.phase);
  const currentIndex = profilePhases.indexOf(delivery.currentPhase);
  const targetIndex = profilePhases.indexOf(targetPhase);
  
  if (targetIndex > currentIndex) {
    return {
      success: false,
      delivery,
      newPhaseRun: null as any,
      message: `Cannot re-enter future phase: ${targetPhase} (current: ${delivery.currentPhase})`,
      reenteredFrom: delivery.currentPhase,
    };
  }
  
  // Complete current phase run if active
  let completedCurrentPhase = currentPhaseRun;
  if (currentPhaseRun.status === "active" || currentPhaseRun.status === "verifying" || currentPhaseRun.status === "blocked") {
    completedCurrentPhase = {
      ...currentPhaseRun,
      status: "completed" as PhaseRunStatus,
      completedAt: new Date().toISOString(),
      revision: currentPhaseRun.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await writeJsonFile(paths, resolve(paths.deliveries, delivery.id, "phases", `${currentPhaseRun.id}.json`), completedCurrentPhase);
  }
  
  // Create new phase run for target phase with incremented sequence
  const newRunSequence = currentPhaseRun.runSequence + 1;
  const newPhaseRun: PhaseRun = {
    schemaVersion: 1,
    id: phaseRunId(`phrun_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`),
    deliveryId: delivery.id,
    phase: targetPhase,
    runSequence: newRunSequence,
    status: "active" as PhaseRunStatus,
    startedAt: new Date().toISOString(),
    completedAt: null,
    blockedAt: null,
    blockedReason: null,
    approvalRequired: targetPhaseReq.approvalRequired ?? false,
    approvalId: null,
    gateResults: [],
    requiredGates: targetPhaseReq.requiredGates ?? [],
    optionalGates: targetPhaseReq.optionalGates ?? [],
    skipReason: null,
    skipBy: null,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as const satisfies PhaseRun;
  
  await writeJsonFile(paths, resolve(paths.deliveries, delivery.id, "phases", `${newPhaseRun.id}.json`), newPhaseRun);
  
  // Update delivery
  const updatedDelivery: Delivery = {
    ...delivery,
    currentPhase: targetPhase,
    currentPhaseRunId: newPhaseRun.id,
    status: "active" as any,
    revision: delivery.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(paths, resolve(paths.deliveries, delivery.id, "delivery.json"), updatedDelivery);
  
  // Log events
  await appendEvent(paths, EventPayloads.phaseAdvanced(
    delivery.id,
    currentPhaseRun.id,
    newPhaseRun.id,
    delivery.currentPhase,
    targetPhase
  ));
  await appendEvent(paths, EventPayloads.phaseEntered(delivery.id, newPhaseRun.id, targetPhase));
  
  // Log re-entry event
  await appendEvent(paths, {
    eventType: "phase_reopened",
    actor: { type: actor.type, id: actor.id },
    entity: { type: "phase", id: newPhaseRun.id },
    deliveryId: delivery.id,
    payload: { fromPhase: delivery.currentPhase, toPhase: targetPhase, reason, reentry: true },
    source: { sessionId: null, toolId: null },
    timestamp: new Date().toISOString(),
  });
  
  return {
    success: true,
    delivery: updatedDelivery,
    newPhaseRun,
    message: `Re-entered ${targetPhase} from ${delivery.currentPhase}: ${reason}`,
    reenteredFrom: delivery.currentPhase,
  };
}

/**
 * Check if re-entry is allowed for a phase
 */
export function canReenterPhase(
  delivery: Delivery,
  currentPhaseRun: PhaseRun,
  targetPhase: DeliveryPhase,
  profile: ReturnType<typeof getProfile>
): { allowed: boolean; reason: string } {
  const profilePhases = profile.phases.map(p => p.phase);
  const currentIndex = profilePhases.indexOf(delivery.currentPhase);
  const targetIndex = profilePhases.indexOf(targetPhase);
  
  if (targetIndex === -1) {
    return { allowed: false, reason: `Phase ${targetPhase} not in profile` };
  }
  
  if (targetIndex > currentIndex) {
    return { allowed: false, reason: `Cannot re-enter future phase` };
  }
  
  // Check if target phase is required and was skipped
  const targetPhaseReq = profile.phases[targetIndex];
  if (!targetPhaseReq) {
    return { allowed: false, reason: `Phase ${targetPhase} not found in profile` };
  }
  if (targetPhaseReq.required && currentPhaseRun.runSequence > 1) {
    // Check if there's already a completed run for this phase
    // This would require checking all phase runs for the delivery
    // For now, allow re-entry
  }
  
  return { allowed: true, reason: "Re-entry allowed" };
}

/**
 * Get re-entry history for a delivery
 */
export async function getReentryHistory(
  paths: VstackPaths,
  deliveryId: string
): Promise<Array<{
  phaseRunId: string;
  phase: DeliveryPhase;
  runSequence: number;
  status: PhaseRunStatus;
  startedAt: string | null;
  completedAt: string | null;
}>> {
  const phaseRunIds = await readJsonFile<string[]>(paths, resolve(paths.deliveries, deliveryId, "phases")).then(
    files => files?.map(f => f.replace(".json", "")) ?? []
  );
  
  const history = [];
  for (const phaseRunId of phaseRunIds) {
    const phaseRun = await readJsonFile<any>(paths, resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`));
    if (phaseRun) {
      history.push({
        phaseRunId: phaseRun.id,
        phase: phaseRun.phase,
        runSequence: phaseRun.runSequence,
        status: phaseRun.status,
        startedAt: phaseRun.startedAt,
        completedAt: phaseRun.completedAt,
      });
    }
  }
  
  return history.sort((a, b) => a.runSequence - b.runSequence);
}

/**
 * Resume a delivery from a specific phase run
 */
export async function resumeFromPhaseRun(
  paths: VstackPaths,
  deliveryId: string,
  phaseRunId: string,
  actor: { type: "plugin" | "agent" | "human"; id: string }
): Promise<ReentryResult> {
  const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
  const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
  
  if (!delivery) {
    return {
      success: false,
      delivery: null as any,
      newPhaseRun: null as any,
      message: "Delivery not found",
      reenteredFrom: "intake",
    };
  }
  
  const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
  const phaseRun = await readJsonFile<any>(paths, phaseRunPath);
  
  if (!phaseRun) {
    return {
      success: false,
      delivery,
      newPhaseRun: null as any,
      message: "Phase run not found",
      reenteredFrom: delivery.currentPhase,
    };
  }
  
  // Complete any currently active phase run
  if (delivery.currentPhaseRunId && delivery.currentPhaseRunId !== phaseRunId) {
    const currentPhaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`);
    const currentPhaseRun = await readJsonFile<any>(paths, currentPhaseRunPath);
    
    if (currentPhaseRun && (currentPhaseRun.status === "active" || currentPhaseRun.status === "verifying" || currentPhaseRun.status === "blocked")) {
      const completed = {
        ...currentPhaseRun,
        status: "completed" as PhaseRunStatus,
        completedAt: new Date().toISOString(),
        revision: currentPhaseRun.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonFile(paths, currentPhaseRunPath, completed);
    }
  }
  
  // Reactivate target phase run
  const reactivatedPhaseRun = {
    ...phaseRun,
    status: "active" as PhaseRunStatus,
    startedAt: phaseRun.startedAt ?? new Date().toISOString(),
    revision: phaseRun.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(paths, phaseRunPath, reactivatedPhaseRun);
  
  // Update delivery
  const updatedDelivery = {
    ...delivery,
    currentPhase: phaseRun.phase,
    currentPhaseRunId: phaseRun.id,
    status: "active" as any,
    revision: delivery.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(paths, deliveryPath, updatedDelivery);
  
  // Log events
  await appendEvent(paths, EventPayloads.phaseEntered(deliveryId, phaseRunId, phaseRun.phase));
  
  return {
    success: true,
    delivery: updatedDelivery,
    newPhaseRun: reactivatedPhaseRun,
    message: `Resumed from ${phaseRun.phase}`,
    reenteredFrom: delivery.currentPhase,
  };
}