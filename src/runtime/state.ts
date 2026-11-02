/**
 * Runtime state bootstrap and projection refresh.
 *
 * Called during plugin setup and after every vstack tool execution so the
 * OpenChamber panel always sees a manifest and a current dashboard index.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { DashboardIndex, ensureManifest, refreshDashboardIndex } from "../dashboard/index-generator.js";

export async function initializeRuntimeState(paths: VstackPaths): Promise<DashboardIndex> {
  await ensureManifest(paths);
  return refreshDashboardIndex(paths);
}

export async function refreshRuntimeState(paths: VstackPaths): Promise<DashboardIndex> {
  await ensureManifest(paths);
  return refreshDashboardIndex(paths);
}
