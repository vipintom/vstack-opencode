/**
 * Dashboard index generation.
 *
 * `.vstack/state/index.json` is the small, frequently-polled projection of
 * active deliveries used by the OpenChamber extension. It is regenerated from
 * delivery files; the revision only advances when the projection changes.
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { VstackPaths, ensureVstackDirs } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, writeFile, FileStoreError } from "../persistence/file-store.js";
import { Delivery, Manifest } from "../schemas/types.js";

export interface DashboardDeliverySummary {
  id: string;
  title: string;
  type: string;
  profile: string;
  status: string;
  currentPhase: string;
  updatedAt: string;
  revision: number;
}

export interface DashboardIndex {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  activeDeliveries: DashboardDeliverySummary[];
}

const ACTIVE_STATUSES = new Set(["proposed", "active", "blocked"]);
const VSTACK_VERSION = "0.1.0";
const CONTENT_VERSION = "1";

function deliverySummary(delivery: Delivery): DashboardDeliverySummary {
  return {
    id: delivery.id,
    title: delivery.title,
    type: delivery.type,
    profile: delivery.profile,
    status: delivery.status,
    currentPhase: delivery.currentPhase,
    updatedAt: delivery.updatedAt,
    revision: delivery.revision,
  };
}

function indexFingerprint(index: DashboardIndex): string {
  return JSON.stringify(
    index.activeDeliveries.map((d) => [
      d.id,
      d.title,
      d.type,
      d.profile,
      d.status,
      d.currentPhase,
      d.updatedAt,
      d.revision,
    ])
  );
}

async function loadDeliveries(paths: VstackPaths): Promise<Delivery[]> {
  if (!existsSync(paths.deliveries)) return [];

  const deliveries: Delivery[] = [];
  for (const entry of readdirSync(paths.deliveries, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("dlv_")) continue;
    const deliveryPath = resolve(paths.deliveries, entry.name, "delivery.json");
    if (!existsSync(deliveryPath)) continue;

    try {
      const delivery = await readJsonFile<Delivery>(paths, deliveryPath);
      if (delivery && typeof delivery === "object") deliveries.push(delivery);
    } catch {
      // A malformed delivery must not break the whole index.
    }
  }

  return deliveries;
}

/**
 * Read the current index, or a synthetic empty index when it does not exist.
 */
export async function readDashboardIndex(paths: VstackPaths): Promise<DashboardIndex> {
  if (!existsSync(paths.index)) {
    return {
      schemaVersion: 1,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
      activeDeliveries: [],
    };
  }

  try {
    const index = await readJsonFile<DashboardIndex>(paths, paths.index);
    if (!index || index.schemaVersion !== 1 || !Array.isArray(index.activeDeliveries)) {
      return {
        schemaVersion: 1,
        revision: 0,
        updatedAt: new Date(0).toISOString(),
        activeDeliveries: [],
      };
    }
    return index;
  } catch {
    return {
      schemaVersion: 1,
      revision: 0,
      updatedAt: new Date(0).toISOString(),
      activeDeliveries: [],
    };
  }
}

/**
 * Rebuild the dashboard index from delivery files.
 * Returns the existing index untouched when the projection has not changed.
 */
export async function refreshDashboardIndex(paths: VstackPaths): Promise<DashboardIndex> {
  await ensureVstackDirs(paths);

  const existing = await readDashboardIndex(paths);
  const deliveries = await loadDeliveries(paths);

  const activeDeliveries = deliveries
    .filter((d) => ACTIVE_STATUSES.has(d.status))
    .map(deliverySummary)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  const next: DashboardIndex = {
    schemaVersion: 1,
    revision: existing.revision,
    updatedAt: existing.updatedAt,
    activeDeliveries,
  };

  const changed =
    existing.revision === 0 ||
    indexFingerprint(existing) !== indexFingerprint(next) ||
    existing.activeDeliveries.length !== activeDeliveries.length;

  if (!changed) return existing;

  next.revision = existing.revision + 1;
  next.updatedAt = new Date().toISOString();

  try {
    await writeJsonFile(paths, paths.index, next, undefined, {
      expectedRevision: existing.revision > 0 ? existing.revision : undefined,
    });
  } catch (error) {
    if (error instanceof FileStoreError && error.code === "REVISION_CONFLICT") {
      const latest = await readDashboardIndex(paths);
      const retry: DashboardIndex = {
        schemaVersion: 1,
        revision: latest.revision + 1,
        updatedAt: new Date().toISOString(),
        activeDeliveries,
      };
      await writeJsonFile(paths, paths.index, retry);
      return retry;
    }
    throw error;
  }

  return next;
}

/**
 * Ensure `.vstack/manifest.json` exists so readers can detect the store.
 */
export async function ensureManifest(paths: VstackPaths): Promise<Manifest> {
  await ensureVstackDirs(paths);

  if (existsSync(paths.manifest)) {
    try {
      const existing = await readJsonFile<Manifest>(paths, paths.manifest);
      if (existing && existing.schemaVersion === 1) return existing;
    } catch {
      // Rewrite a malformed manifest below.
    }
  }

  const now = new Date().toISOString();
  const manifest: Manifest = {
    schemaVersion: 1,
    vstackVersion: VSTACK_VERSION,
    contentVersion: CONTENT_VERSION,
    projectId: `prj_${paths.root.replace(/[^a-zA-Z0-9]/g, "").slice(-16) || "default"}`,
    createdAt: now,
    updatedAt: now,
  };

  await writeFile(paths, paths.manifest, JSON.stringify(manifest, null, 2));
  return manifest;
}
