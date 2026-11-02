/**
 * Delivery lifecycle engine
 * Coordinates phase transitions, gate evaluation, and profile management
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { 
  Delivery, 
  PhaseRun, 
  DeliveryPhase, 
  DeliveryStatus, 
  ProfileId, 
  EvidenceType, 
  EventType,
  DeliveryId,
  PhaseRunId,
  deliveryId,
  phaseRunId
} from "../schemas/types.js";
import { readJsonFile, writeJsonFile, listFiles, fileExists } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { getProfile, getAvailableProfiles, getRequiredGates, getOptionalGates, isApprovalRequired, getApprovalType, canSkipPhase } from "./profiles.js";
import { 
  canTransitionPhase, 
  checkPhaseGates, 
  requestPhaseTransition, 
  startPhase, 
  blockPhase, 
  unblockPhase,
  getValidNextPhases
} from "./phase-transitions.js";
import { TransitionResult } from "./phase-transitions.js";
import { resolve } from "node:path";

export interface LifecycleEngine {
  createDelivery(params: CreateDeliveryParams): Promise<Delivery>;
  getDelivery(deliveryId: string): Promise<Delivery | null>;
  listDeliveries(filter?: DeliveryFilter): Promise<Delivery[]>;
  startDelivery(deliveryId: string, actorId: string, actorType: "plugin" | "agent" | "human", sessionId?: string): Promise<Delivery>;
  advancePhase(deliveryId: DeliveryId, targetPhase: DeliveryPhase, options: AdvanceOptions): Promise<TransitionResult>;
  blockPhase(deliveryId: DeliveryId, reason: string, actorId: string, actorType: "plugin" | "agent" | "human"): Promise<TransitionResult>;
  unblockPhase(deliveryId: DeliveryId, actorId: string, actorType: "plugin" | "agent" | "human"): Promise<TransitionResult>;
  finishDelivery(deliveryId: DeliveryId, actorId: string, actorType: "plugin" | "agent" | "human"): Promise<Delivery>;
  getPhaseStatus(deliveryId: DeliveryId): Promise<PhaseStatus>;
  evaluateGates(deliveryId: DeliveryId): Promise<GateEvaluation>;
  skipPhase(deliveryId: DeliveryId, targetPhase: DeliveryPhase, reason: string, actorId: string): Promise<TransitionResult>;
}

export interface CreateDeliveryParams {
  title: string;
  description: string;
  type: Delivery["type"];
  profile: ProfileId;
  acceptanceCriteria: string[];
  risk: Delivery["risk"];
  labels: string[];
  createdBy: string;
}

export interface DeliveryFilter {
  status?: DeliveryStatus[];
  profile?: ProfileId[];
  type?: Delivery["type"][];
  limit?: number;
  offset?: number;
}

export interface AdvanceOptions {
  skipGates?: boolean;
  skipApproval?: boolean;
  skipReason?: string;
  actorId: string;
  actorType: "plugin" | "agent" | "human";
  sessionId?: string;
  toolId?: string;
}

export interface PhaseStatus {
  delivery: Delivery;
  currentPhaseRun: PhaseRun | null;
  profile: ProfileId;
  nextPhases: DeliveryPhase[];
  gates: GateStatus[];
  blocked: boolean;
  blockReason: string | null;
  canAdvance: boolean;
  advanceBlockers: string[];
}

export interface GateStatus {
  gateId: EvidenceType;
  required: boolean;
  status: "passed" | "failed" | "pending" | "skipped";
  evidenceIds: string[];
  evaluatedAt: string | null;
}

export interface GateEvaluation {
  phase: DeliveryPhase;
  allRequiredPassed: boolean;
  gates: GateStatus[];
  missingRequired: EvidenceType[];
}

export async function createLifecycleEngine(paths: VstackPaths): Promise<LifecycleEngine> {
  const engine: LifecycleEngine = {
    async createDelivery(params) {
      const profile = getProfile(params.profile);
      const now = new Date().toISOString();
      const newDeliveryId = deliveryId(`dlv_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`);
      
      // Create first phase run (intake)
      const firstPhase = profile.phases[0]?.phase ?? "intake";
      const firstPhaseRun: PhaseRun = {
        schemaVersion: 1,
        id: phaseRunId(`phrun_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`),
        deliveryId: newDeliveryId,
        phase: firstPhase,
        runSequence: 1,
        status: "not_started",
        startedAt: null,
        completedAt: null,
        blockedAt: null,
        blockedReason: null,
        approvalRequired: false,
        approvalId: null,
        gateResults: [],
        requiredGates: [],
        optionalGates: [],
        skipReason: null,
        skipBy: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      
      const delivery: Delivery = {
        schemaVersion: 1,
        id: newDeliveryId,
        title: params.title,
        description: params.description,
        type: params.type,
        profile: params.profile,
        status: "proposed",
        currentPhase: firstPhase,
        currentPhaseRunId: firstPhaseRun.id,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        acceptanceCriteria: params.acceptanceCriteria,
        risk: params.risk,
        labels: params.labels,
        references: {},
        createdBy: params.createdBy,
      };
      
      // Create delivery directory structure
      const deliveryDir = resolve(paths.deliveries, newDeliveryId);
      const dirs = ["tasks", "phases", "agent-runs", "reviews", "findings", "evidence", "approvals", "artifacts"];
      for (const dir of dirs) {
        const fs = await import("node:fs");
        if (!fs.existsSync(resolve(deliveryDir, dir))) {
          fs.mkdirSync(resolve(deliveryDir, dir), { recursive: true });
        }
      }
      
      // Write delivery and first phase run
      await writeJsonFile(paths, resolve(deliveryDir, "delivery.json"), delivery);
      await writeJsonFile(paths, resolve(deliveryDir, "phases", `${firstPhaseRun.id}.json`), firstPhaseRun);
      
      // Update manifest
      await updateManifest(paths, { updatedAt: now });
      
      // Log event
      await appendEvent(paths, EventPayloads.deliveryCreated(newDeliveryId, params.title, params.profile));
      
      return delivery;
    },
    
    async getDelivery(deliveryId) {
      const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
      return readJsonFile<Delivery>(paths, deliveryPath);
    },
    
    async listDeliveries(filter = {}) {
      const deliveryIds = listFiles(paths, paths.deliveries);
      const deliveries: Delivery[] = [];
      
      for (const id of deliveryIds) {
        const delivery = await this.getDelivery(id);
        if (!delivery) continue;
        
        if (filter.status && !filter.status.includes(delivery.status)) continue;
        if (filter.profile && !filter.profile.includes(delivery.profile)) continue;
        if (filter.type && !filter.type.includes(delivery.type)) continue;
        
        deliveries.push(delivery);
      }
      
      // Sort by updatedAt descending
      deliveries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      
      if (filter.offset) {
        deliveries.splice(0, filter.offset);
      }
      if (filter.limit) {
        deliveries.splice(filter.limit);
      }
      
      return deliveries;
    },
    
    async startDelivery(deliveryId: DeliveryId, actorId: string, actorType: "plugin" | "agent" | "human", sessionId?: string) {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      if (delivery.status !== "proposed") {
        throw new Error(`Delivery not in proposed status: ${delivery.status}`);
      }
      
      // Start first phase
      const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`);
      await startPhase(paths, deliveryId, delivery.currentPhaseRunId!, actorId, actorType, sessionId);
      
      // Update delivery status
      const updatedDelivery: Delivery = {
        ...delivery,
        status: "active" as DeliveryStatus,
        updatedAt: new Date().toISOString(),
        revision: delivery.revision + 1,
      };
      
      await writeJsonFile(paths, resolve(paths.deliveries, deliveryId, "delivery.json"), updatedDelivery);
      
      return updatedDelivery;
    },
    
    async advancePhase(deliveryId: DeliveryId, targetPhase: DeliveryPhase, options: AdvanceOptions) {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      const currentPhaseRun = delivery.currentPhaseRunId
        ? await readJsonFile<PhaseRun>(paths, resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`))
        : null;
      
      return requestPhaseTransition(paths, {
        delivery,
        currentPhaseRun,
        profileId: delivery.profile,
        actorId: options.actorId,
        actorType: options.actorType,
        sessionId: options.sessionId,
        toolId: options.toolId,
      }, targetPhase, options);
    },
    
    async blockPhase(deliveryId: DeliveryId, reason: string, actorId: string, actorType: "plugin" | "agent" | "human") {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      if (!delivery.currentPhaseRunId) throw new Error("No current phase run");
      
      return blockPhase(paths, deliveryId, delivery.currentPhaseRunId, reason, actorId, actorType);
    },
    
    async unblockPhase(deliveryId: DeliveryId, actorId: string, actorType: "plugin" | "agent" | "human") {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      if (!delivery.currentPhaseRunId) throw new Error("No current phase run");
      
      return unblockPhase(paths, deliveryId, delivery.currentPhaseRunId, actorId, actorType);
    },
    
    async finishDelivery(deliveryId: DeliveryId, actorId: string, actorType: "plugin" | "agent" | "human") {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      if (delivery.status !== "active" && delivery.status !== "blocked") {
        throw new Error(`Cannot finish delivery in status: ${delivery.status}`);
      }
      
      // Verify all required phases completed
      const profile = getProfile(delivery.profile);
      const incompleteRequiredPhases = profile.phases
        .filter(p => p.required)
        .filter(p => {
          const phaseRuns = listFiles(paths, resolve(paths.deliveries, deliveryId, "phases"));
          return !phaseRuns.some(prId => {
            const pr = readJsonFileSync<PhaseRun>(paths, resolve(paths.deliveries, deliveryId, "phases", `${prId}.json`));
            return pr?.phase === p.phase && pr?.status === "completed";
          });
        });
      
      if (incompleteRequiredPhases.length > 0) {
        throw new Error(`Required phases incomplete: ${incompleteRequiredPhases.map(p => p.phase).join(", ")}`);
      }
      
      // Mark current phase as completed if not already
      if (delivery.currentPhaseRunId) {
        const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`);
        const phaseRun = await readJsonFile<PhaseRun>(paths, phaseRunPath);
        
        if (phaseRun && phaseRun.status !== "completed") {
          const updatedPhaseRun = {
            ...phaseRun,
            status: "completed" as const,
            completedAt: new Date().toISOString(),
            revision: phaseRun.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          await writeJsonFile(paths, phaseRunPath, updatedPhaseRun);
        }
      }
      
      // Create completed phase run
      const completedPhaseRun: PhaseRun = {
        schemaVersion: 1,
        id: phaseRunId(`phrun_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`),
        deliveryId,
        phase: "completed",
        runSequence: (delivery.currentPhaseRunId ? 1 : 0) + 1,
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        blockedAt: null,
        blockedReason: null,
        approvalRequired: false,
        approvalId: null,
        gateResults: [],
        requiredGates: [],
        optionalGates: [],
        skipReason: null,
        skipBy: null,
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      
      await writeJsonFile(paths, resolve(paths.deliveries, deliveryId, "phases", `${completedPhaseRun.id}.json`), completedPhaseRun);
      
      // Update delivery
      const updatedDelivery: Delivery = {
        ...delivery,
        status: "completed" as DeliveryStatus,
        currentPhase: "completed" as DeliveryPhase,
        currentPhaseRunId: completedPhaseRun.id,
        updatedAt: new Date().toISOString(),
        revision: delivery.revision + 1,
      };
      
      await writeJsonFile(paths, resolve(paths.deliveries, deliveryId, "delivery.json"), updatedDelivery);
      
      // Update manifest
      await updateManifest(paths, { updatedAt: new Date().toISOString() });
      
      await appendEvent(paths, {
        ...EventPayloads.deliveryCreated(deliveryId, delivery.title, delivery.profile),
        eventType: "delivery_completed",
        actor: { type: actorType, id: actorId },
        payload: { deliveryId, title: delivery.title },
      });
      
      return updatedDelivery;
    },
    
    async getPhaseStatus(deliveryId) {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      const currentPhaseRun = delivery.currentPhaseRunId
        ? await readJsonFile<PhaseRun>(paths, resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`))
        : null;
      
      const profile = getProfile(delivery.profile);
      const nextPhases = getValidNextPhases(delivery.profile, delivery.currentPhase);
      
      // Get gate statuses
      const requiredGates = getRequiredGates(delivery.profile, delivery.currentPhase);
      const optionalGates = getOptionalGates(delivery.profile, delivery.currentPhase);
      const allGates = [...requiredGates.map(g => ({ gateId: g, required: true })), ...optionalGates.map(g => ({ gateId: g, required: false }))];
      
      const gates: GateStatus[] = [];
      if (currentPhaseRun) {
        for (const { gateId, required } of allGates) {
          const gateResult = currentPhaseRun.gateResults.find(gr => gr.gateId === gateId);
          gates.push({
            gateId,
            required,
            status: gateResult?.status ?? "pending",
            evidenceIds: gateResult?.evidenceIds ?? [],
            evaluatedAt: gateResult?.evaluatedAt ?? null,
          });
        }
      } else {
        for (const { gateId, required } of allGates) {
          gates.push({
            gateId,
            required,
            status: "pending",
            evidenceIds: [],
            evaluatedAt: null,
          });
        }
      }
      
      const blocked = currentPhaseRun?.status === "blocked";
      const blockReason = currentPhaseRun?.blockedReason ?? null;
      
      // Check if can advance
      const { satisfied, missingGates } = currentPhaseRun
        ? await checkPhaseGates(paths, deliveryId, currentPhaseRun.id, delivery.profile)
        : { satisfied: false, missingGates: requiredGates };
      
      const approvalRequired = profile.phases.find(p => p.phase === nextPhases[0])?.approvalRequired ?? false;
      
      return {
        delivery,
        currentPhaseRun,
        profile: delivery.profile,
        nextPhases,
        gates,
        blocked,
        blockReason,
        canAdvance: satisfied && !blocked && !approvalRequired,
        advanceBlockers: [
          ...(blocked ? [`Phase blocked: ${blockReason}`] : []),
          ...(missingGates.length > 0 ? [`Missing gates: ${missingGates.join(", ")}`] : []),
          ...(approvalRequired ? [`Approval required for next phase`] : []),
        ],
      };
    },
    
    async evaluateGates(deliveryId) {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      const currentPhaseRun = delivery.currentPhaseRunId
        ? await readJsonFile<PhaseRun>(paths, resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`))
        : null;
      
      if (!currentPhaseRun) {
        return {
          phase: delivery.currentPhase,
          allRequiredPassed: false,
          gates: [],
          missingRequired: getRequiredGates(delivery.profile, delivery.currentPhase),
        };
      }
      
      const requiredGates = getRequiredGates(delivery.profile, delivery.currentPhase);
      const optionalGates = getOptionalGates(delivery.profile, delivery.currentPhase);
      const allGates = [...requiredGates.map(g => ({ gateId: g, required: true })), ...optionalGates.map(g => ({ gateId: g, required: false }))];
      
      const gates: GateStatus[] = [];
      for (const { gateId, required } of allGates) {
        const gateResult = currentPhaseRun.gateResults.find(gr => gr.gateId === gateId);
        gates.push({
          gateId,
          required,
          status: gateResult?.status ?? "pending",
          evidenceIds: gateResult?.evidenceIds ?? [],
          evaluatedAt: gateResult?.evaluatedAt ?? null,
        });
      }
      
      const missingRequired = requiredGates.filter(g => 
        !currentPhaseRun.gateResults.some(gr => gr.gateId === g && gr.status === "passed")
      );
      
      return {
        phase: delivery.currentPhase,
        allRequiredPassed: missingRequired.length === 0,
        gates,
        missingRequired,
      };
    },
    
    async skipPhase(deliveryId: DeliveryId, targetPhase: DeliveryPhase, reason: string, actorId: string) {
      const delivery = await this.getDelivery(deliveryId);
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      const currentPhaseRun = delivery.currentPhaseRunId
        ? await readJsonFile<PhaseRun>(paths, resolve(paths.deliveries, deliveryId, "phases", `${delivery.currentPhaseRunId}.json`))
        : null;
      
      return requestPhaseTransition(paths, {
        delivery,
        currentPhaseRun,
        profileId: delivery.profile,
        actorId,
        actorType: "human",
      }, targetPhase, { skipGates: true, skipReason: reason });
    },
  };
  return engine;
}

/**
 * Update manifest file
 */
async function updateManifest(paths: VstackPaths, updates: Partial<{ updatedAt: string }>): Promise<void> {
  const manifestPath = paths.manifest;
  const fs = await import("node:fs");
  
  let manifest = { schemaVersion: 1, vstackVersion: "0.1.0", contentVersion: "0.1.0", projectId: "", createdAt: "", updatedAt: "", revision: 1 };
  
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  }
  
  manifest = { ...manifest, ...updates, updatedAt: updates.updatedAt || new Date().toISOString(), revision: manifest.revision + 1 };
  
  await writeJsonFile(paths, manifestPath, manifest);
}

/**
 * Synchronous read for internal use
 */
function readJsonFileSync<T>(paths: VstackPaths, filePath: string): T | null {
  const fs = require("node:fs");
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}