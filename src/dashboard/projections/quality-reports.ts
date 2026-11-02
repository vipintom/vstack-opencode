/**
 * Quality Summary Report Generator
 * Generates quality/check summaries from evidence
 */

import { VstackPaths } from "../../persistence/repository-root.js";
import { resolve } from "node:path";
import { writeJsonFile } from "../../persistence/file-store.js";
import { qualitySummaryPath } from "./paths.js";

interface EvidenceRecord {
  checkId: string;
  status: "passed" | "failed" | "skipped" | "error" | "timeout" | "cancelled";
}

interface ChecksByType {
  [key: string]: { passed: number; failed: number };
}

export async function publishQualitySummary(paths: VstackPaths, deliveryId: string): Promise<void> {
  const dir = resolve(paths.deliveries, deliveryId, "evidence");
  if (!require("node:fs").existsSync(dir)) return;
  
  const { readdirSync, readFileSync } = await import("node:fs");
  const files = readdirSync(dir).filter(f => f.endsWith(".json"));
  
  let checksTotal = 0;
  let checksPassed = 0;
  let checksFailed = 0;
  let checksSkipped = 0;
  const checksByType: ChecksByType = {};
  
  for (const file of files) {
    const ev = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as EvidenceRecord;
    checksTotal++;
    if (ev.status === "passed") checksPassed++;
    else if (ev.status === "failed") checksFailed++;
    else if (ev.status === "skipped") checksSkipped++;
    
    const checkId = ev.checkId;
    if (!checksByType[checkId]) checksByType[checkId] = { passed: 0, failed: 0 };
    if (ev.status === "passed") checksByType[checkId]!.passed++;
    else if (ev.status === "failed") checksByType[checkId]!.failed++;
  }
  
  const report = {
    schemaVersion: 1,
    revision: 1,
    deliveryId,
    checksTotal,
    checksPassed,
    checksFailed,
    checksSkipped,
    checksByType,
    reviewFindings: { critical: 0, high: 0, medium: 0, low: 0 },
    generatedAt: new Date().toISOString(),
  };
  
  await writeJsonFile(paths, qualitySummaryPath(paths, deliveryId), report);
}

interface EvidenceRecord {
  checkId: string;
  status: "passed" | "failed" | "skipped" | "error" | "timeout" | "cancelled";
}