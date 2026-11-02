/**
 * Activity Report Generator
 * Generates activity summaries from event log
 */

import { VstackPaths } from "../../persistence/repository-root.js";
import { resolve } from "node:path";
import { readEvents } from "../../persistence/event-log.js";
import { writeJsonFile } from "../../persistence/file-store.js";
import { ActivitySummary } from "./types.js";
import { activityReportPath } from "./paths.js";

export async function publishActivityReport(paths: VstackPaths, deliveryId: string): Promise<void> {
  const { readEvents } = await import("../../persistence/event-log.js");
  const events = await readEvents(paths, { deliveryId, limit: 500 });
  
  const report: ActivitySummary = {
    schemaVersion: 1,
    revision: 1,
    deliveryId,
    activities: events.map((e: any) => ({
      timestamp: e.timestamp,
      eventType: e.eventType,
      actor: `${e.actor.type}:${e.actor.id}`,
      entity: e.entity,
      summary: JSON.stringify(e.payload),
      outcome: e.payload?.outcome ? String(e.payload.outcome) : undefined,
    })).reverse(),
    generatedAt: new Date().toISOString(),
  };
  
  await writeJsonFile(paths, resolve(paths.reports, "activity", `${deliveryId}.json`), report);
}