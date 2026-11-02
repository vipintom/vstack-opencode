/**
 * Evidence ledger.
 *
 * Stores structured evidence records under the delivery folder and keeps
 * bounded stdout/stderr logs next to them.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { VstackPaths, getDeliveryDir } from "../persistence/repository-root.js";
import { writeJsonFile } from "../persistence/file-store.js";
import { Evidence, EvidenceId, EvidenceSource, EvidenceProvenance, EvidenceOutcome, EvidenceType, evidenceId } from "../schemas/types.js";
import { randomUUID } from "node:crypto";

export interface RecordEvidenceParams {
  deliveryId: string;
  taskId?: string | null;
  phaseRunId?: string | null;
  type: EvidenceType;
  source: EvidenceSource;
  provenance: EvidenceProvenance;
  outcome: EvidenceOutcome;
  checkId: string;
  command: string[];
  workingDirectory: string;
  commitRef: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  status: Evidence["status"];
  stdout?: string;
  stderr?: string;
  stdoutPath?: string | null;
  stderrPath?: string | null;
  summary: string;
  executionId: string;
  sessionId?: string | null;
  agentRunId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EvidenceFilters {
  type?: EvidenceType[];
  status?: Evidence["status"][];
  checkId?: string;
  provenance?: EvidenceProvenance[];
  outcome?: EvidenceOutcome[];
}

export interface EvidenceLedger {
  record(params: RecordEvidenceParams): Promise<Evidence>;
  list(deliveryId: string, filters?: EvidenceFilters): Promise<Evidence[]>;
  get(deliveryId: string, evidenceId: string): Promise<Evidence | null>;
}

function evidenceDir(paths: VstackPaths, deliveryId: string): string {
  return resolve(getDeliveryDir(paths, deliveryId), "evidence");
}

function existsSyncSafe(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function createEvidenceLedger(paths: VstackPaths): Promise<EvidenceLedger> {
  return {
    async record(params) {
      const directory = evidenceDir(paths, params.deliveryId);
      mkdirSync(directory, { recursive: true });

      const id = evidenceId(`evd_${randomUUID().replace(/-/g, "").slice(0, 16)}`);
      const now = new Date().toISOString();

      let stdoutPath = params.stdoutPath ?? null;
      let stderrPath = params.stderrPath ?? null;

      if (params.stdout !== undefined) {
        const target = resolve(directory, `${id}.stdout.log`);
        writeFileSync(target, params.stdout, "utf-8");
        stdoutPath = target;
      }
      if (params.stderr !== undefined) {
        const target = resolve(directory, `${id}.stderr.log`);
        writeFileSync(target, params.stderr, "utf-8");
        stderrPath = target;
      }

      const evidence: Evidence = {
        schemaVersion: 1,
        id,
        deliveryId: params.deliveryId as Evidence["deliveryId"],
        taskId: (params.taskId ?? null) as Evidence["taskId"],
        phaseRunId: (params.phaseRunId ?? null) as Evidence["phaseRunId"],
        type: params.type,
        source: params.source,
        provenance: params.provenance,
        outcome: params.outcome,
        checkId: params.checkId,
        command: params.command,
        workingDirectory: params.workingDirectory,
        commitRef: params.commitRef,
        startedAt: params.startedAt ?? now,
        completedAt: params.completedAt ?? now,
        exitCode: params.exitCode ?? null,
        status: params.status,
        stdoutPath,
        stderrPath,
        summary: params.summary,
        executionId: params.executionId,
        sessionId: params.sessionId ?? null,
        agentRunId: (params.agentRunId ?? null) as Evidence["agentRunId"],
        metadata: params.metadata ?? {},
        revision: 0,
      };

      await writeJsonFile(paths, resolve(directory, `${id}.json`), evidence);
      return evidence;
    },

    async list(deliveryId, filters = {}) {
      const directory = evidenceDir(paths, deliveryId);
      if (!existsSyncSafe(directory)) return [];

      const records: Evidence[] = [];
      for (const fileName of readdirSync(directory)) {
        if (!fileName.endsWith(".json")) continue;
        try {
          const parsed = JSON.parse(
            readFileSync(resolve(directory, fileName), "utf-8")
          ) as Evidence;
          records.push(parsed);
        } catch {
          continue;
        }
      }

      const filtered = records.filter((record) => {
        if (filters.type && !filters.type.includes(record.type)) return false;
        if (filters.status && !filters.status.includes(record.status)) return false;
        if (filters.checkId && record.checkId !== filters.checkId) return false;
        if (filters.provenance && !filters.provenance.includes(record.provenance)) return false;
        if (filters.outcome && !filters.outcome.includes(record.outcome)) return false;
        return true;
      });

      filtered.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      return filtered;
    },

    async get(deliveryId, id) {
      const target = resolve(evidenceDir(paths, deliveryId), `${id}.json`);
      try {
        return JSON.parse(readFileSync(target, "utf-8")) as Evidence;
      } catch {
        return null;
      }
    },
  };
}