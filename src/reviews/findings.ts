/**
 * Review findings management
 * Handles finding creation, tracking, and resolution
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles } from "../persistence/file-store.js";
import { appendEvent } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface FindingConfig {
  requireRecommendation: boolean;
  requireEvidence: boolean;
  allowDeferred: boolean;
  maxFindingsPerReview: number;
}

export interface Finding {
  schemaVersion: 1;
  id: string;
  deliveryId: string;
  reviewRunId: string;
  reviewerAgentId: string;
  lens: "correctness_regression" | "architecture_design" | "security_data" | "performance_resources" | "maintainability_style" | "test_adequacy" | "documentation_migration";
  severity: "critical" | "high" | "medium" | "low" | "informational";
  category: string;
  title: string;
  explanation: string;
  filePath: string | null;
  lineRange: { start: number; end: number } | null;
  reproducibility: string | null;
  recommendation: string;
  status: "open" | "accepted" | "fixed" | "false_positive" | "deferred";
  owner: string | null;
  remediationTaskId: string | null;
  resolutionEvidenceIds: string[];
  firstSeenReviewRunId: string;
  lastReviewedReviewRunId: string | null;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  revision?: number;
}

export interface FindingFilters {
  severity?: ("critical" | "high" | "medium" | "low" | "informational")[];
  lens?: string[];
  status?: ("open" | "accepted" | "fixed" | "false_positive" | "deferred")[];
  reviewerAgentId?: string;
  reviewRunId?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Create findings manager
 */
export async function createFindingsManager(paths: VstackPaths) {
  return {
    /**
     * Create a new finding
     */
    async createFinding(
      deliveryId: string,
      reviewRunId: string,
      finding: Omit<Finding, "id" | "schemaVersion" | "createdAt" | "updatedAt" | "status" | "owner" | "remediationTaskId" | "resolutionEvidenceIds" | "firstSeenReviewRunId" | "lastReviewedReviewRunId">
    ): Promise<Finding> {
      const findingId = `fnd_${uuidv4()}`;
      const now = new Date().toISOString();
      
      const newFinding: Finding = {
        schemaVersion: 1,
        id: findingId,
        ...finding,
        deliveryId,
        reviewRunId,
        status: "open",
        owner: null,
        remediationTaskId: null,
        resolutionEvidenceIds: [],
        firstSeenReviewRunId: reviewRunId,
        lastReviewedReviewRunId: null,
        createdAt: now,
        updatedAt: now,
      };
      
      // Save finding
      const findingPath = resolve(paths.deliveries, deliveryId, "findings", `${findingId}.json`);
      await writeJsonFile(paths, findingPath, newFinding);
      
      // Update review run
      const reviewRunPath = resolve(paths.deliveries, deliveryId, "reviews", `${reviewRunId}.json`);
      const reviewRun = await readJsonFile<any>(paths, reviewRunPath);
      
      if (reviewRun) {
        reviewRun.findings.push(findingId);
        reviewRun.revision += 1;
        await writeJsonFile(paths, reviewRunPath, reviewRun);
      }
      
      return newFinding;
    },
    
    /**
     * Get finding by ID
     */
    async getFinding(deliveryId: string, findingId: string): Promise<Finding | null> {
      const findingPath = resolve(paths.deliveries, deliveryId, "findings", `${findingId}.json`);
      return readJsonFile<Finding>(paths, findingPath);
    },
    
    /**
     * List findings with filters
     */
    async listFindings(deliveryId: string, filters: FindingFilters = {}): Promise<Finding[]> {
      const findingIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "findings"));
      const findings: Finding[] = [];
      
      for (const findingId of findingIds) {
        const findingPath = resolve(paths.deliveries, deliveryId, "findings", `${findingId}.json`);
        const finding = await readJsonFile<Finding>(paths, findingPath);
        
        if (!finding) continue;
        
        if (filters.severity && !filters.severity.includes(finding.severity)) continue;
        if (filters.lens && !filters.lens.includes(finding.lens)) continue;
        if (filters.status && !filters.status.includes(finding.status)) continue;
        if (filters.reviewerAgentId && finding.reviewerAgentId !== filters.reviewerAgentId) continue;
        
        findings.push(finding);
      }
      
      // Sort by severity (critical first) then by createdAt
      const severityOrder = { critical: 5, high: 4, medium: 3, low: 2, informational: 1 };
      findings.sort((a, b) => {
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityDiff !== 0) return severityDiff;
        return a.createdAt.localeCompare(b.createdAt);
      });
      
      if (filters.offset) findings.splice(0, filters.offset);
      if (filters.limit) findings.splice(filters.limit);
      
      return findings;
    },
    
    /**
     * Update finding status
     */
    async updateFindingStatus(
      deliveryId: string,
      findingId: string,
      status: Finding["status"],
      updates: Partial<Finding> = {}
    ): Promise<Finding | null> {
      const findingPath = resolve(paths.deliveries, deliveryId, "findings", `${findingId}.json`);
      const finding = await readJsonFile<Finding>(paths, findingPath);
      
      if (!finding) return null;
      
      const updatedFinding = {
        ...finding,
        ...updates,
        status,
        updatedAt: new Date().toISOString(),
        lastReviewedReviewRunId: updates.lastReviewedReviewRunId ?? finding.lastReviewedReviewRunId,
      };
      
      await writeJsonFile(paths, findingPath, updatedFinding);
      
      return updatedFinding;
    },
    
    /**
     * Assign finding to owner
     */
    async assignFinding(
      deliveryId: string,
      findingId: string,
      owner: string,
      remediationTaskId?: string
    ): Promise<Finding | null> {
      const findingPath = resolve(paths.deliveries, deliveryId, "findings", `${findingId}.json`);
      const finding = await readJsonFile<Finding>(paths, findingPath);
      
      if (!finding) return null;
      
      const updatedFinding = {
        ...finding,
        owner,
        remediationTaskId: remediationTaskId ?? null,
        status: "accepted" as const, // Accepted means someone is working on it
        updatedAt: new Date().toISOString(),
      };
      
      await writeJsonFile(paths, findingPath, updatedFinding);
      
      return updatedFinding;
    },
    
    /**
     * Resolve finding
     */
    async resolveFinding(
      deliveryId: string,
      findingId: string,
      resolution: {
        status: "fixed" | "false_positive" | "deferred";
        resolutionEvidenceIds: string[];
        resolvedBy: string;
        notes?: string;
      }
    ): Promise<Finding | null> {
      const findingPath = resolve(paths.deliveries, deliveryId, "findings", `${findingId}.json`);
      const finding = await readJsonFile<Finding>(paths, findingPath);
      
      if (!finding) return null;
      
      const statusMap: Record<string, Finding["status"]> = {
        fixed: "fixed",
        false_positive: "false_positive",
        deferred: "deferred",
      };
      
      const newStatus = statusMap[resolution.status] ?? "fixed";
      const updatedFinding = {
        ...finding,
        status: newStatus,
        resolutionEvidenceIds: resolution.resolutionEvidenceIds,
        owner: resolution.resolvedBy,
        updatedAt: new Date().toISOString(),
        notes: resolution.notes,
      };
      
      await writeJsonFile(paths, findingPath, updatedFinding);
      
      return updatedFinding;
    },
    
    /**
     * Get finding statistics
     */
    async getStatistics(deliveryId: string): Promise<{
      total: number;
      bySeverity: Record<string, number>;
      byStatus: Record<string, number>;
      byLens: Record<string, number>;
      open: number;
      resolved: number;
    }> {
      const findings = await this.listFindings(deliveryId);
      
      const bySeverity: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const byLens: Record<string, number> = {};
      
      for (const finding of findings) {
        bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
        byStatus[finding.status] = (byStatus[finding.status] || 0) + 1;
        byLens[finding.lens] = (byLens[finding.lens] || 0) + 1;
      }
      
      return {
        total: findings.length,
        bySeverity,
        byStatus,
        byLens,
        open: findings.filter(f => f.status === "open").length,
        resolved: findings.filter(f => f.status === "fixed" || f.status === "false_positive").length,
      };
    },
    
    /**
     * Deduplicate findings across reviewers
     */
    async deduplicateFindings(
      deliveryId: string,
      reviewRunId: string
    ): Promise<{
      originalCount: number;
      deduplicatedCount: number;
      duplicates: Array<{ original: string; duplicates: string[] }>;
    }> {
      const findings = await this.listFindings(deliveryId, { 
        reviewRunId: [reviewRunId] 
      });
      
      // Group by similarity (file + line range + title similarity)
      const groups = new Map<string, Finding[]>();
      
      for (const finding of findings) {
        const key = `${finding.filePath || "no-file"}:${finding.lineRange?.start || 0}:${finding.title.toLowerCase().substring(0, 50)}`;
        
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(finding);
      }
      
      const duplicates: Array<{ original: string; duplicates: string[] }> = [];
      let deduplicatedCount = 0;
      
      for (const [, group] of groups) {
        if (group.length > 1) {
          const original = group[0];
          if (!original) continue;
          const dupes = group.slice(1).map(f => f.id);
          
          duplicates.push({ original: original.id, duplicates: dupes });
          deduplicatedCount += dupes.length;
          
          // Mark duplicates as false_positive or merge
          for (const dupe of group.slice(1)) {
            await this.updateFindingStatus(deliveryId, dupe.id, "false_positive", {
              notes: `Duplicate of ${original.id}`,
            });
          }
        }
      }
      
      return {
        originalCount: findings.length,
        deduplicatedCount: findings.length - deduplicatedCount,
        duplicates,
      };
    },
  };
}