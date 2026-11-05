import { describe, expect, it } from "vitest";
import { validateState } from "../src/state/schema.js";

const base = {
  schemaVersion: 1,
  revision: 1,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  delivery: null,
};

describe("state contract", () => {
  it("accepts an empty state", () => {
    expect(validateState(base).valid).toBe(true);
  });

  it("rejects a missing schema version", () => {
    const { schemaVersion, ...rest } = base;
    expect(validateState(rest).valid).toBe(false);
  });

  it("rejects an unknown top-level field", () => {
    expect(validateState({ ...base, extra: true }).valid).toBe(false);
  });

  it("rejects an unknown task status", () => {
    const state = structuredClone(base);
    state.delivery = {
      id: "dlv_test",
      title: "test",
      tier: "standard",
      playbook: "fix-bug",
      phase: "build",
      status: "active",
      outcome: "the bug is gone",
      doneWhen: "the repro exits 0",
      skills: ["debug"],
      skipped: [],
      tasks: [
        {
          id: "tsk_1",
          title: "fix it",
          status: "finished",
          check: "pnpm test",
          evidenceId: null,
          artifact: null,
          createdAt: base.createdAt,
          updatedAt: base.createdAt,
        },
      ],
      evidence: [],
      decisions: [],
      handoffs: [],
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      closedAt: null,
    };
    expect(validateState(state).valid).toBe(false);
  });

  it("rejects an unknown evidence result", () => {
    const state = structuredClone(base);
    state.delivery = {
      id: "dlv_test",
      title: "test",
      tier: "quick",
      playbook: "fix-bug",
      phase: "prove",
      status: "active",
      outcome: "the bug is gone",
      doneWhen: "the repro exits 0",
      skills: [],
      skipped: [],
      tasks: [],
      evidence: [
        {
          id: "ev_1",
          claim: "repro exits 0",
          check: "pnpm test",
          result: "looks-good",
          artifact: null,
          createdAt: base.createdAt,
        },
      ],
      decisions: [],
      handoffs: [],
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      closedAt: null,
    };
    expect(validateState(state).valid).toBe(false);
  });
});
