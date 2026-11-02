/**
 * Project Memory Store
 * 
 * Curated project knowledge, distinct from runtime state and history.
 * Stores: project overview, architecture, conventions, decisions, lessons, handoffs.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, fileExists, deleteFile } from "../persistence/file-store.js";
import { resolve } from "node:path";

export type MemoryCategory = 
  | "overview"
  | "architecture"
  | "conventions"
  | "decisions"
  | "lessons"
  | "handoffs"
  | "constraints";

export interface MemoryItem {
  schemaVersion: 1;
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  source?: string;
  tags: string[];
  status: "current" | "superseded";
  supersededBy?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface MemoryIndex {
  schemaVersion: 1;
  items: MemoryItem[];
  updatedAt: string;
  revision: number;
}

export interface MemoryStore {
  listCategories(): Promise<MemoryCategory[]>;
  getCategoryIndex(category: MemoryCategory): Promise<MemoryItem[]>;
  createItem(category: MemoryCategory, item: Omit<MemoryItem, "id" | "schemaVersion" | "createdAt" | "updatedAt" | "status">): Promise<MemoryItem>;
  getItem(category: MemoryCategory, id: string): Promise<MemoryItem | null>;
  updateItem(category: MemoryCategory, id: string, updates: Partial<Omit<MemoryItem, "id" | "schemaVersion" | "createdAt">>): Promise<MemoryItem>;
  deleteItem(category: MemoryCategory, id: string): Promise<void>;
  supersedeItem(category: MemoryCategory, id: string, newItemId: string): Promise<void>;
  searchItems(query: string, categories?: MemoryCategory[]): Promise<MemoryItem[]>;
  getFullIndex(): Promise<MemoryIndex>;
  updateIndex(): Promise<void>;
}

function categoryDir(paths: VstackPaths, category: MemoryCategory): string {
  return resolve(paths.memory, category);
}

function itemPath(paths: VstackPaths, category: MemoryCategory, id: string): string {
  return resolve(categoryDir(paths, category), `${id}.json`);
}

function indexPath(paths: VstackPaths): string {
  return resolve(paths.memory, "index.json");
}

async function updateIndexImpl(paths: VstackPaths): Promise<void> {
  const allCategories: MemoryCategory[] = [
    "overview", "architecture", "conventions", 
    "decisions", "lessons", "handoffs", "constraints"
  ];
  const items: MemoryItem[] = [];
  
  for (const cat of allCategories) {
    const dir = categoryDir(paths, cat);
    if (!fileExists(paths, dir)) continue;
    
    const files = listFiles(paths, dir);
    for (const file of files) {
      const item = await readJsonFile<MemoryItem>(paths, resolve(dir, `${file}.json`));
      if (item) items.push(item);
    }
  }
  
  const fullIndex: MemoryIndex = {
    schemaVersion: 1,
    items,
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
  
  await writeJsonFile(paths, indexPath(paths), fullIndex);
}

async function getCategoryIndexImpl(paths: VstackPaths, category: MemoryCategory): Promise<MemoryItem[]> {
  const dir = categoryDir(paths, category);
  if (!fileExists(paths, dir)) return [];
  
  const files = listFiles(paths, dir);
  const items: MemoryItem[] = [];
  
  for (const file of files) {
    const item = await readJsonFile<MemoryItem>(paths, resolve(dir, `${file}.json`));
    if (item) items.push(item);
  }
  
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getFullIndexImpl(paths: VstackPaths): Promise<MemoryIndex> {
  const allCategories: MemoryCategory[] = [
    "overview", "architecture", "conventions", 
    "decisions", "lessons", "handoffs", "constraints"
  ];
  const items: MemoryItem[] = [];
  
  for (const cat of allCategories) {
    const catItems = await getCategoryIndexImpl(paths, cat);
    items.push(...catItems);
  }
  
  return {
    schemaVersion: 1,
    items,
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
}

export async function createMemoryStore(paths: VstackPaths): Promise<MemoryStore> {
  return {
    async listCategories() {
      return [
        "overview", "architecture", "conventions", 
        "decisions", "lessons", "handoffs", "constraints"
      ];
    },

    async getCategoryIndex(category) {
      return getCategoryIndexImpl(paths, category);
    },

    async createItem(category, item) {
      const dir = categoryDir(paths, category);
      const id = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const now = new Date().toISOString();
      
      const memoryItem: MemoryItem = {
        schemaVersion: 1,
        id,
        category,
        title: item.title,
        content: item.content,
        source: item.source,
        tags: item.tags || [],
        status: "current",
        createdAt: now,
        updatedAt: now,
        revision: 1,
      };
      
      // Ensure category directory exists
      const { mkdirSync } = await import("node:fs");
      const categoryDirPath = categoryDir(paths, category);
      mkdirSync(categoryDirPath, { recursive: true });
      
      await writeJsonFile(paths, itemPath(paths, category, id), memoryItem);
      await updateIndexImpl(paths);
      
      return memoryItem;
    },

    async getItem(category, id) {
      return readJsonFile<MemoryItem>(paths, itemPath(paths, category, id));
    },

    async updateItem(category, id, updates) {
      const existing = await readJsonFile<MemoryItem>(paths, itemPath(paths, category, id));
      if (!existing) throw new Error(`Memory item not found: ${category}/${id}`);
      
      const updated: MemoryItem = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
        revision: existing.revision + 1,
      };
      
      await writeJsonFile(paths, itemPath(paths, category, id), updated);
      await updateIndexImpl(paths);
      
      return updated;
    },

    async deleteItem(category, id) {
      await deleteFile(paths, itemPath(paths, category, id));
      await updateIndexImpl(paths);
    },

    async supersedeItem(category, id, newItemId) {
      const existing = await readJsonFile<MemoryItem>(paths, itemPath(paths, category, id));
      if (!existing) throw new Error(`Memory item not found: ${category}/${id}`);
      
      await writeJsonFile(paths, itemPath(paths, category, id), {
        ...existing,
        status: "superseded",
        supersededBy: newItemId,
        updatedAt: new Date().toISOString(),
        revision: existing.revision + 1,
      });
      await updateIndexImpl(paths);
    },

    async searchItems(query, categories) {
      const targetCategories = categories || [
        "overview", "architecture", "conventions", 
        "decisions", "lessons", "handoffs", "constraints"
      ];
      const results: MemoryItem[] = [];
      const lowerQuery = query.toLowerCase();
      
      for (const cat of targetCategories) {
        const items = await getCategoryIndexImpl(paths, cat);
        for (const item of items) {
          if (item.status !== "current") continue;
          if (
            item.title.toLowerCase().includes(lowerQuery) ||
            item.content.toLowerCase().includes(lowerQuery) ||
            item.tags.some((t: string) => t.toLowerCase().includes(lowerQuery))
          ) {
            results.push(item);
          }
        }
      }
      
      return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getFullIndex() {
      return getFullIndexImpl(paths);
    },

    async updateIndex() {
      await updateIndexImpl(paths);
    },
  };
}