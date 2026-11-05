import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state/store.js";

function store(): StateStore {
  return new StateStore(mkdtempSync(join(tmpdir(), "vstack-store-")));
}

function delivery(id: string) {
  return {
    id,
    title: "test delivery",
    tier: "standard" as const,
    playbook: "fix-bug",
    phase: "shape" as const,
    status: "active" as const,
    outcome: "the bug is gone",
    doneWhen: "the repro exits 0",
    skills: ["debug"],
    skipped: [],
    tasks: [],
    evidence: [],
    decisions: [],
    handoffs: [],
    createdAt: "2026-11-05T10:00:00.000Z",
    updatedAt: "2026-11-05T10:00:00.000Z",
    closedAt: null,
  };
}

describe("state store", () => {
  it("reads null before the first delivery", async () => {
    expect(await store().read()).toBeNull();
  });

  it("writes the state atomically and bumps the revision", async () => {
    const s = store();
    await s.transaction((state) => {
      state.delivery = delivery("dlv_1");
      return { result: null, event: { type: "delivery.opened", data: { id: "dlv_1" } } };
    });
    const first = await s.read();
    expect(first?.revision).toBe(1);
    expect(first?.delivery?.id).toBe("dlv_1");

    await s.transaction((state) => {
      state.delivery!.title = "renamed";
      return { result: null, event: { type: "delivery.updated", data: {} } };
    });
    const second = await s.read();
    expect(second?.revision).toBe(2);
    expect(second?.delivery?.title).toBe("renamed");
  });

  it("keeps history append-only and ordered", async () => {
    const s = store();
    await s.transaction((state) => {
      state.delivery = delivery("dlv_1");
      return { result: null, event: { type: "delivery.opened", data: {} } };
    });
    await s.transaction(() => ({ result: null, event: { type: "task.added", data: {} } }));
    const history = await s.readHistory();
    expect(history.map((e) => e.type)).toEqual(["delivery.opened", "task.added"]);
    expect(readFileSync(s.historyPath, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("does not lose concurrent writes", async () => {
    const s = store();
    await s.transaction((state) => {
      state.delivery = delivery("dlv_1");
      return { result: null, event: { type: "delivery.opened", data: {} } };
    });
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        s.transaction((state) => {
          state.delivery!.tasks.push({
            id: `tsk_${i}`,
            title: `task ${i}`,
            status: "todo",
            check: "true",
            evidenceId: null,
            artifact: null,
            createdAt: "2026-11-05T10:00:00.000Z",
            updatedAt: "2026-11-05T10:00:00.000Z",
          });
          return { result: null, event: { type: "task.added", data: { id: `tsk_${i}` } } };
        })
      )
    );
    const state = await s.read();
    expect(state?.delivery?.tasks).toHaveLength(12);
  });

  it("refuses a malformed state file", async () => {
    const s = store();
    await s.transaction((state) => {
      state.delivery = delivery("dlv_1");
      return { result: null, event: { type: "delivery.opened", data: {} } };
    });
    const fs = await import("node:fs");
    fs.writeFileSync(s.statePath, "{not json", "utf8");
    await expect(s.read()).rejects.toMatchObject({ code: "STATE_INVALID" });
  });
});
