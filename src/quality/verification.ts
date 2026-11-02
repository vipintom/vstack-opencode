/**
 * Verification engine
 * Runs phase/delivery verification and evaluates quality gates
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Evidence, EvidenceType, EvidenceSource, EvidenceId } from "../schemas/types.js";
import { readJsonFile, writeJsonFile, listFiles } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { GateRegistry, defaultGateEvaluator, EvaluationContext } from "./gates.js";
import { createTestManager } from "./test.js";
import { createSecurityManager } from "./security.js";
import { createAcceptanceManager } from "./acceptance.js";

export interface VerificationConfig {
  requireAllGates: boolean;
  allowManualVerification: boolean;
  autoRunOnPhaseComplete: boolean;
}

export interface PhaseVerificationResult {
  phase: string;
  phaseRunId: string;
  passed: boolean;
  requiredGatesPassed: number;
  requiredGatesTotal: number;
  optionalGatesPassed: number;
  optionalGatesTotal: number;
  failedGates: string[];
  missingGates: string[];
  evidenceIds: EvidenceId[];
  duration: number;
}

export interface DeliveryVerificationResult {
  deliveryId: string;
  passed: boolean;
  phaseResults: PhaseVerificationResult[];
  overallEvidenceIds: EvidenceId[];
  duration: number;
}

/**
 * Create verification engine
 */
export async function createVerificationEngine(paths: VstackPaths) {
  const gateRegistry = new GateRegistry();
  const testManager = await createTestManager(paths);
  const securityManager = await createSecurityManager(paths);
  const acceptanceManager = await createAcceptanceManager(paths);
  
  return {
    /**
     * Verify a phase (run all required gates)
     */
    async verifyPhase(
      deliveryId: string,
      phaseRunId: string,
      config: VerificationConfig
    ): Promise<PhaseVerificationResult> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      
      // Get phase run
      const phaseRunPath = resolve(paths.deliveries, deliveryId, "phases", `${phaseRunId}.json`);
      const phaseRun = await readJsonFile<any>(paths, phaseRunPath);
      
      if (!phaseRun) {
        throw new Error(`Phase run ${phaseRunId} not found`);
      }
      
      const requiredGates = phaseRun.requiredGates;
      const optionalGates = phaseRun.optionalGates;
      const allGates = [...requiredGates, ...optionalGates];
      
      let requiredPassed = 0;
      let requiredTotal = requiredGates.length;
      let optionalPassed = 0;
      let optionalTotal = optionalGates.length;
      const failedGates: string[] = [];
      const missingGates: string[] = [];
      const allEvidenceIds: EvidenceId[] = [];
      
      // Evaluate required gates
      for (const gateId of requiredGates) {
        const gate = gateRegistry.get(gateId);
        if (!gate) {
          missingGates.push(gateId);
          failedGates.push(gateId);
          continue;
        }
        
        const result = await defaultGateEvaluator(gate, {
          deliveryId,
          phaseRunId,
          workingDirectory: ".",
          commitRef: await this.getCommitRef(deliveryId),
          environment: process.env as Record<string, string>,
        });
        
        if (result.status === "passed") {
          requiredPassed++;
        } else {
          failedGates.push(gateId);
        }
        
        if (result.evidence.checkId) {
          allEvidenceIds.push(result.evidence.checkId as EvidenceId);
        }
      }
      
      // Evaluate optional gates
      for (const gateId of optionalGates) {
        const gate = gateRegistry.get(gateId);
        if (!gate) {
          missingGates.push(gateId);
          continue;
        }
        
        const result = await defaultGateEvaluator(gate, {
          deliveryId,
          phaseRunId,
          workingDirectory: ".",
          commitRef: await this.getCommitRef(deliveryId),
          environment: process.env as Record<string, string>,
        });
        
        if (result.status === "passed") {
          optionalPassed++;
        }
        
        if (result.evidence.checkId) {
          allEvidenceIds.push(result.evidence.checkId as EvidenceId);
        }
      }
      
      const completedAt = new Date().toISOString();
      const duration = Date.now() - startedMs;
      const passed = failedGates.length === 0 && missingGates.length === 0;
      
      // Update phase run with gate results
      const updatedPhaseRun = {
        ...phaseRun,
        gateResults: phaseRun.gateResults.map((gr: any) => {
          const gateResult = allGates.includes(gr.gateId) ? gr : gr; // Would be updated by evaluator
          return gateResult;
        }),
        status: passed ? "completed" : "verifying",
        completedAt: passed ? completedAt : null,
        revision: phaseRun.revision + 1,
        updatedAt: completedAt,
      };
      
      await writeJsonFile(paths, phaseRunPath, updatedPhaseRun);
      
      // Update delivery
      const deliveryPath = resolve(paths.deliveries, deliveryId, "delivery.json");
      const delivery = await readJsonFile<any>(paths, deliveryPath);
      
      if (delivery) {
        const updatedDelivery = {
          ...delivery,
          status: passed ? "active" : "verifying",
          updatedAt: completedAt,
          revision: delivery.revision + 1,
        };
        await writeJsonFile(paths, deliveryPath, updatedDelivery);
      }
      
      // Log event
      await appendEvent(paths, EventPayloads.checkCompleted(deliveryId, allEvidenceIds[0] ?? "", "phase_verification", passed ? "passed" : "failed"));
      
      return {
        phase: phaseRun.phase,
        phaseRunId,
        passed,
        requiredGatesPassed: requiredPassed,
        requiredGatesTotal: requiredTotal,
        optionalGatesPassed: optionalPassed,
        optionalGatesTotal: optionalTotal,
        failedGates,
        missingGates,
        evidenceIds: allEvidenceIds,
        duration,
      };
    },
    
    /**
     * Verify entire delivery
     */
    async verifyDelivery(
      deliveryId: string,
      config: VerificationConfig
    ): Promise<DeliveryVerificationResult> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      
      const phaseRunIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "phases"));
      const phaseResults: PhaseVerificationResult[] = [];
      const allEvidenceIds: EvidenceId[] = [];
      
      for (const phaseRunId of phaseRunIds) {
        const result = await this.verifyPhase(deliveryId, phaseRunId, config);
        phaseResults.push(result);
        allEvidenceIds.push(...result.evidenceIds);
      }
      
      const completedAt = new Date().toISOString();
      const duration = Date.now() - startedMs;
      const passed = phaseResults.every(r => r.passed);
      
      return {
        deliveryId,
        passed,
        phaseResults,
        overallEvidenceIds: allEvidenceIds,
        duration,
      };
    },
    
    /**
     * Get commit reference for delivery
     */
    async getCommitRef(deliveryId: string): Promise<string> {
      // In real implementation, get from git
      return "HEAD";
    },
  };
}