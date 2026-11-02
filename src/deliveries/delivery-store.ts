/**
 * Simplified Delivery Store
 * 
 * CRUD operations for deliveries without lifecycle engine coupling.
 * Status: active | blocked | completed | cancelled
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile, listFiles, fileExists, deleteFile } from "../persistence/file-store.js";
import { Delivery, DeliveryId, DeliveryStatus, DeliveryType, deliveryId } from "../schemas/types.js";
import { resolve } from "node:path";
import { v4 as uuidv4 } from "uuid";

export interface DeliveryStore {
  createDelivery(params: CreateDeliveryParams): Promise<Delivery>;
  getDelivery(deliveryId: DeliveryId): Promise<Delivery | null>;
  listDeliveries(filter?: DeliveryFilter): Promise<Delivery[]>;
  updateDelivery(deliveryId: DeliveryId, updates: DeliveryUpdates): Promise<Delivery>;
  deleteDelivery(deliveryId: DeliveryId): Promise<void>;
}

export interface CreateDeliveryParams {
  title: string;
  objective: string;
  type: DeliveryType;
  acceptanceCriteria: string[];
  risk: "low" | "medium" | "high" | "critical";
  labels: string[];
  createdBy: string;
}

export interface DeliveryUpdates {
  title?: string;
  objective?: string;
  status?: DeliveryStatus;
  acceptanceCriteria?: string[];
  blockedReason?: string;
  completedAt?: string;
}

export interface DeliveryFilter {
  status?: DeliveryStatus[];
  type?: DeliveryType[];
  limit?: number;
  offset?: number;
}

function deliveryDir(paths: VstackPaths): string {
  return resolve(paths.deliveries);
}

function deliveryFile(paths: VstackPaths, deliveryId: string): string {
  return resolve(deliveryDir(paths), deliveryId, "delivery.json");
}

export async function createDeliveryStore(paths: VstackPaths): Promise<DeliveryStore> {
  return {
    async createDelivery(params) {
      const id = deliveryId(`dlv_${uuidv4()}`);
      const now = new Date().toISOString();
      
      const delivery: Delivery = {
        schemaVersion: 1,
        id,
        title: params.title,
        description: params.objective,
        type: params.type,
        profile: "feature",
        status: "active",
        currentPhase: "planning",
        currentPhaseRunId: null,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        acceptanceCriteria: params.acceptanceCriteria,
        risk: params.risk,
        labels: params.labels,
        references: {},
        createdBy: params.createdBy,
      };
      
      // Ensure delivery directory exists
      const { mkdirSync } = await import("node:fs");
      const dir = deliveryFile(paths, id).replace("/delivery.json", "");
      mkdirSync(dir, { recursive: true });
      
      await writeJsonFile(paths, deliveryFile(paths, id), delivery);
      return delivery;
    },

    async getDelivery(deliveryId) {
      return readJsonFile<Delivery>(paths, deliveryFile(paths, deliveryId));
    },

    async listDeliveries(filter = {}) {
      const dirs = listFiles(paths, deliveryDir(paths));
      const deliveries: Delivery[] = [];
      
      for (const dir of dirs) {
        const delivery = await readJsonFile<Delivery>(paths, deliveryFile(paths, dir));
        if (!delivery) continue;
        
        if (filter.status && !filter.status.includes(delivery.status)) continue;
        if (filter.type && !filter.type.includes(delivery.type)) continue;
        
        deliveries.push(delivery);
      }
      
      deliveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      
      const offset = filter.offset || 0;
      const limit = filter.limit || deliveries.length;
      return deliveries.slice(offset, offset + limit);
    },

    async updateDelivery(deliveryId, updates) {
      const delivery = await readJsonFile<Delivery>(paths, deliveryFile(paths, deliveryId));
      if (!delivery) throw new Error(`Delivery ${deliveryId} not found`);
      
      const updated: Delivery = {
        ...delivery,
        ...updates,
        updatedAt: new Date().toISOString(),
        revision: delivery.revision + 1,
      };
      
      await writeJsonFile(paths, deliveryFile(paths, deliveryId), updated);
      return updated;
    },

    async deleteDelivery(deliveryId) {
      await deleteFile(paths, deliveryFile(paths, deliveryId));
    },
  };
}