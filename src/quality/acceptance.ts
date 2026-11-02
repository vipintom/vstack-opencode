/**
 * Acceptance criteria verification
 * Handles validation of acceptance criteria for tasks and deliveries
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

interface AcceptanceCriteriaFile {
  revision: number;
  deliveryId: string;
  criteria: AcceptanceCriterion[];
  updatedAt: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  type: "functional" | "non_functional" | "security" | "performance" | "usability";
  verificationMethod: "automated_test" | "manual_test" | "inspection" | "demonstration" | "analysis";
  status: "pending" | "verified" | "failed" | "waived";
  evidence?: string; // reference to evidence ID
  verifiedAt?: string;
  verifiedBy?: string;
  notes?: string;
}

export interface AcceptanceCriteriaConfig {
  requireAllVerified: boolean;
  allowWaivers: boolean;
  waiverRequiresApproval: boolean;
}

export interface VerificationResult {
  criterionId: string;
  status: "verified" | "failed" | "waived";
  evidence?: string;
  verifiedAt: string;
  verifiedBy: string;
  notes?: string;
}

export interface AcceptanceReport {
  deliveryId: string;
  totalCriteria: number;
  verified: number;
  failed: number;
  waived: number;
  pending: number;
  overallPassed: boolean;
  verifications: VerificationResult[];
  generatedAt: string;
}

/**
 * Create acceptance criteria manager
 */
export async function createAcceptanceManager(paths: VstackPaths) {
  return {
    /**
     * Add acceptance criteria to a task/delivery
     */
    async addCriteria(
      deliveryId: string,
      criteria: Omit<AcceptanceCriterion, "id" | "status">[]
    ): Promise<AcceptanceCriterion[]> {
      const now = new Date().toISOString();
      
      const newCriteria: AcceptanceCriterion[] = criteria.map(c => ({
        ...c,
        id: `ac_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        status: "pending",
      }));
      
      // Store in delivery metadata
      const criteriaPath = resolve(paths.deliveries, deliveryId, "acceptance-criteria.json");
      
      let existing: AcceptanceCriterion[] = [];
      const existingData = await readJsonFile<any>(paths, criteriaPath);
      if (existingData?.criteria) {
        existing = existingData.criteria;
      }
      
      const allCriteria = [...existing, ...newCriteria];
      
      const fileData: AcceptanceCriteriaFile = {
        revision: (existingData?.revision ?? 0) + 1,
        deliveryId,
        criteria: allCriteria,
        updatedAt: now,
      };
      
      await writeJsonFile(paths, criteriaPath, fileData);
      
      return newCriteria;
    },
    
    /**
     * Get acceptance criteria for a delivery
     */
    async getCriteria(deliveryId: string): Promise<AcceptanceCriterion[]> {
      const criteriaPath = resolve(paths.deliveries, deliveryId, "acceptance-criteria.json");
      const data = await readJsonFile<any>(paths, criteriaPath);
      return (data?.criteria ?? []) as AcceptanceCriterion[];
    },
    
    /**
     * Verify a single criterion
     */
    async verifyCriterion(
      deliveryId: string,
      criterionId: string,
      verification: VerificationResult
    ): Promise<AcceptanceCriterion | null> {
      const criteria = await this.getCriteria(deliveryId);
      const index = criteria.findIndex(c => c.id === criterionId);
      
      if (index === -1) return null;
      
      const existing = criteria[index]!;
      const updatedCriterion: AcceptanceCriterion = {
        id: existing.id,
        description: existing.description,
        type: existing.type,
        verificationMethod: existing.verificationMethod,
        status: verification.status,
        evidence: verification.evidence,
        verifiedAt: verification.verifiedAt,
        verifiedBy: verification.verifiedBy,
        notes: verification.notes,
      };
      
      criteria[index] = updatedCriterion;
      
      const criteriaPath = resolve(paths.deliveries, deliveryId, "acceptance-criteria.json");
      const existingData = await readJsonFile<AcceptanceCriteriaFile>(paths, criteriaPath);
      const fileData: AcceptanceCriteriaFile = {
        revision: (existingData?.revision ?? 0) + 1,
        deliveryId,
        criteria,
        updatedAt: new Date().toISOString(),
      };
      
      await writeJsonFile(paths, criteriaPath, fileData);
      
      return updatedCriterion;
    },
    
    /**
     * Verify multiple criteria (batch)
     */
    async verifyCriteria(
      deliveryId: string,
      verifications: VerificationResult[]
    ): Promise<AcceptanceCriterion[]> {
      const criteria = await this.getCriteria(deliveryId);
      let updated = false;
      
      for (const verification of verifications) {
        const index = criteria.findIndex(c => c.id === verification.criterionId);
        if (index !== -1) {
          const existing = criteria[index]!;
          criteria[index] = {
            id: existing.id,
            description: existing.description,
            type: existing.type,
            verificationMethod: existing.verificationMethod,
            status: verification.status,
            evidence: verification.evidence,
            verifiedAt: verification.verifiedAt,
            verifiedBy: verification.verifiedBy,
            notes: verification.notes,
          };
          updated = true;
        }
      }
      
      if (updated) {
        const criteriaPath = resolve(paths.deliveries, deliveryId, "acceptance-criteria.json");
        const existingData = await readJsonFile<AcceptanceCriteriaFile>(paths, criteriaPath);
        const fileData: AcceptanceCriteriaFile = {
          revision: (existingData?.revision ?? 0) + 1,
          deliveryId,
          criteria,
          updatedAt: new Date().toISOString(),
        };
        await writeJsonFile(paths, criteriaPath, fileData);
      }
      
      return criteria;
    },
    
    /**
     * Generate acceptance report
     */
    async generateReport(deliveryId: string): Promise<AcceptanceReport> {
      const criteria = await this.getCriteria(deliveryId);
      
      const verified = criteria.filter(c => c.status === "verified").length;
      const failed = criteria.filter(c => c.status === "failed").length;
      const waived = criteria.filter(c => c.status === "waived").length;
      const pending = criteria.filter(c => c.status === "pending").length;
      
      const overallPassed = criteria.length > 0 && 
        criteria.every(c => c.status === "verified" || c.status === "waived");
      
      const verifications: VerificationResult[] = criteria
        .filter(c => c.status !== "pending")
        .map(c => ({
          criterionId: c.id,
          status: c.status as "verified" | "failed" | "waived",
          evidence: c.evidence,
          verifiedAt: c.verifiedAt ?? "",
          verifiedBy: c.verifiedBy ?? "",
          notes: c.notes,
        }));
      
      return {
        deliveryId,
        totalCriteria: criteria.length,
        verified,
        failed,
        waived,
        pending,
        overallPassed,
        verifications,
        generatedAt: new Date().toISOString(),
      };
    },
    
    /**
     * Check if all criteria are satisfied
     */
    async areAllSatisfied(deliveryId: string): Promise<boolean> {
      const criteria = await this.getCriteria(deliveryId);
      return criteria.length > 0 && criteria.every(c => c.status === "verified" || c.status === "waived");
    },
    
    /**
     * Get pending criteria
     */
    async getPendingCriteria(deliveryId: string): Promise<AcceptanceCriterion[]> {
      const criteria = await this.getCriteria(deliveryId);
      return criteria.filter(c => c.status === "pending");
    },
    
    /**
     * Waive a criterion (requires approval)
     */
    async waiveCriterion(
      deliveryId: string,
      criterionId: string,
      approvedBy: string,
      reason: string
    ): Promise<AcceptanceCriterion | null> {
      return this.verifyCriterion(deliveryId, criterionId, {
        criterionId,
        status: "waived",
        verifiedAt: new Date().toISOString(),
        verifiedBy: approvedBy,
        notes: `Waived: ${reason}`,
      });
    },
  };
}