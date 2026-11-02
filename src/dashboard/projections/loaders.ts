/**
 * Projection Data Loaders
 * Loads data from .vstack/ for generating projections
 */

import { VstackPaths } from "../../persistence/repository-root.js";
import { readJsonFile, listFiles } from "../../persistence/file-store.js";
import { readEvents } from "../../persistence/event-log.js";
import { Evidence } from "../../schemas/types.js";
import { resolve } from "node:path";

export async function loadDeliveries(paths: VstackPaths) {
  const { readdirSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  
  if (!existsSync(paths.deliveries)) return [];
  
  const deliveries = [];
  for (const entry of readdirSync(paths.deliveries, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("dlv_")) continue;
    try {
      const { readJsonFile } = await import("../../persistence/file-store.js");
      const delivery = await readJsonFile<any>(paths, resolve(paths.deliveries, entry.name, "delivery.json"));
      if (delivery) deliveries.push(delivery);
    } catch {}
  }
  return deliveries;
}

export async function getTasksForDelivery(paths: VstackPaths, deliveryId: string) {
  const { listFiles, readJsonFile } = await import("../../persistence/file-store.js");
  const { resolve } = await import("node:path");
  
  const taskIds = listFiles(paths, resolve(paths.deliveries, deliveryId, "tasks"));
  const tasks = [];
  for (const taskId of taskIds) {
    const task = await readJsonFile<any>(paths, resolve(paths.deliveries, deliveryId, "tasks", `${taskId}.json`));
    if (task) tasks.push(task);
  }
  return tasks;
}

export async function getAgentRunsForDelivery(paths: VstackPaths, deliveryId: string) {
  const { listFiles, readJsonFile } = await import("../../persistence/file-store.js");
  const { resolve } = await import("node:path");
  
  const dir = resolve(paths.deliveries, deliveryId, "agent-runs");
  if (!require("node:fs").existsSync(dir)) return [];
  const runIds = listFiles(paths, dir);
  const runs = [];
  for (const runId of runIds) {
    const run = await readJsonFile<any>(paths, resolve(dir, `${runId}.json`));
    if (run) runs.push(run);
  }
  return runs;
}

export async function getEvidenceForDelivery(paths: VstackPaths, deliveryId: string) {
  const { listFiles, readJsonFile } = await import("../../persistence/file-store.js");
  const { resolve } = await import("node:path");
  const dir = resolve(paths.deliveries, deliveryId, "evidence");
  if (!require("node:fs").existsSync(dir)) return [];
  const { readdirSync, readFileSync } = await import("node:fs");
  const files = readdirSync(dir).filter(f => f.endsWith(".json"));
  const evidence = [];
  for (const file of files) {
    const ev = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as any;
    evidence.push(ev);
  }
  return evidence;
}