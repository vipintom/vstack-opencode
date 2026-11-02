/**
 * Memory Index Report Generator
 * Generates memory index report for OpenChamber
 */

import { VstackPaths } from "../../persistence/repository-root.js";
import { resolve } from "node:path";
import { readJsonFile, writeJsonFile } from "../../persistence/file-store.js";
import { MemoryIndexReport } from "./types.js";
import { memoryIndexPath } from "./paths.js";

interface MemoryItem {
  id: string;
  title: string;
  category: string;
  status: string;
  updatedAt: string;
  tags: string[];
}

export async function publishMemoryIndex(paths: VstackPaths): Promise<void> {
  const memoryIndexPath_ = resolve(paths.memory, "index.json");
  
  let memoryIndex: { items: MemoryItem[] } = { items: [] };
  if (require("node:fs").existsSync(memoryIndexPath_)) {
    try {
      const result = await readJsonFile<{ items: MemoryItem[] }>(paths, memoryIndexPath_);
      if (result) memoryIndex = result;
    } catch {}
  }
  
  const report: MemoryIndexReport = {
    schemaVersion: 1,
    revision: 1,
    categories: {} as Record<string, Array<{ id: string; title: string; category: string; status: string; updatedAt: string; tags: string[] }>>,
    generatedAt: new Date().toISOString(),
  };
  
  for (const item of memoryIndex.items || []) {
    const category = item.category;
    if (!report.categories[category]) report.categories[category] = [];
    report.categories[category]!.push({
      id: item.id,
      title: item.title,
      category: item.category,
      status: item.status,
      updatedAt: item.updatedAt || item.updatedAt,
      tags: item.tags || [],
    });
  }
  
  await writeJsonFile(paths, resolve(paths.reports, "memory-index.json"), report);
}