import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateState } from "./schema.js";
import type { Delivery, HistoryEvent, HistoryEventType, State } from "./types.js";
import { VstackError } from "./types.js";

const LOCK_RETRIES = 80;
const LOCK_WAIT_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function now(): string {
  return new Date().toISOString();
}

function initialState(): State {
  const ts = now();
  return {
    schemaVersion: 1,
    revision: 0,
    createdAt: ts,
    updatedAt: ts,
    delivery: null,
  };
}

export interface TransactionOutput<T> {
  result: T;
  event?: {
    type: HistoryEventType;
    data: Record<string, unknown>;
  };
}

export class StateStore {
  readonly root: string;
  readonly statePath: string;
  readonly historyPath: string;
  readonly lockPath: string;

  constructor(root: string) {
    this.root = resolve(root);
    const dir = join(this.root, ".vstack");
    this.statePath = join(dir, "state.json");
    this.historyPath = join(dir, "history.jsonl");
    this.lockPath = join(dir, "lock");
  }

  async read(): Promise<State | null> {
    if (!existsSync(this.statePath)) return null;
    return this.parse(readFileSync(this.statePath, "utf8"));
  }

  async readHistory(): Promise<HistoryEvent[]> {
    if (!existsSync(this.historyPath)) return [];
    const text = readFileSync(this.historyPath, "utf8");
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line) as HistoryEvent;
        } catch {
          throw new VstackError("STATE_INVALID", `history line ${index + 1} is not JSON`);
        }
      });
  }

  async transaction<T>(fn: (state: State) => TransactionOutput<T>): Promise<T> {
    return this.withLock(async () => {
      const current = await this.read();
      const state = current ?? initialState();
      const { result, event } = fn(state);
      state.revision = (current?.revision ?? 0) + 1;
      state.updatedAt = now();
      this.write(state);
      if (event) this.append(event.type, state, event.data);
      return result;
    });
  }

  writeDelivery(delivery: Delivery, content: string): string {
    if (!/^dlv_[a-zA-Z0-9_-]+$/.test(delivery.id)) {
      throw new VstackError("INVALID_ID", `invalid delivery id: ${delivery.id}`);
    }
    const dir = join(this.root, ".vstack", "deliveries");
    mkdirSync(dir, { recursive: true });
    const markdownPath = join(dir, `${delivery.id}.md`);
    writeFileSync(markdownPath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    writeFileSync(join(dir, `${delivery.id}.json`), `${JSON.stringify(delivery, null, 2)}\n`, "utf8");
    return markdownPath;
  }

  private append(type: HistoryEventType, state: State, data: Record<string, unknown>): void {
    const deliveryId = state.delivery?.id;
    if (!deliveryId) throw new VstackError("NO_DELIVERY", "history needs a delivery");
    const event: HistoryEvent = { ts: now(), type, deliveryId, data };
    appendFileSync(this.historyPath, `${JSON.stringify(event)}\n`, "utf8");
  }

  private parse(text: string): State {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new VstackError("STATE_INVALID", "state.json is not valid JSON");
    }
    const result = validateState(parsed);
    if (!result.valid) {
      throw new VstackError("STATE_INVALID", `state.json violates the contract: ${result.errors.join("; ")}`);
    }
    return parsed as State;
  }

  private write(state: State): void {
    const result = validateState(state);
    if (!result.valid) {
      throw new VstackError("STATE_INVALID", `refusing to write invalid state: ${result.errors.join("; ")}`);
    }
    mkdirSync(dirname(this.statePath), { recursive: true });
    const temp = `${this.statePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temp, this.statePath);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(dirname(this.lockPath), { recursive: true });
    let held = false;
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt += 1) {
      try {
        mkdirSync(this.lockPath);
        held = true;
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        await sleep(LOCK_WAIT_MS);
      }
    }
    if (!held) throw new VstackError("LOCK_TIMEOUT", "another vstack operation holds the lock");
    try {
      return await fn();
    } finally {
      try {
        if (statSync(this.lockPath).isDirectory()) rmSync(this.lockPath, { recursive: true, force: true });
      } catch {
        // already released
      }
    }
  }
}
