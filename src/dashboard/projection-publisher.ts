/**
 * Projection Publisher
 * Main entry point for generating all OpenChamber projections
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { ensureVstackDirs } from "../persistence/repository-root.js";
import { loadDeliveries } from "./projections/loaders.js";
import { publishDeliveryReport } from "./projections/delivery-reports.js";
import { publishActivityReport } from "./projections/activity-reports.js";
import { publishMemoryIndex } from "./projections/memory-reports.js";
import { publishQualitySummary } from "./projections/quality-reports.js";
import { ensureProjectionDirs } from "./projections/paths.js";

export async function publishProjections(paths: VstackPaths): Promise<void> {
  await ensureProjectionDirs(paths);
  
  const deliveries = await loadDeliveries(paths);
  
  for (const delivery of deliveries) {
    await publishDeliveryReport(paths, delivery);
    await publishActivityReport(paths, delivery.id);
    await publishQualitySummary(paths, delivery.id);
  }
  
  await publishMemoryIndex(paths);
}

export { loadDeliveries } from "./projections/loaders.js";
export { publishDeliveryReport } from "./projections/delivery-reports.js";
export { publishActivityReport } from "./projections/activity-reports.js";
export { publishMemoryIndex } from "./projections/memory-reports.js";
export { publishQualitySummary } from "./projections/quality-reports.js";
export { ensureProjectionDirs } from "./projections/paths.js";