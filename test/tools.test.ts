import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state/store.js";
import { createTools, type VstackTool } from "../src/tools/index.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vstack-tools-"));
  const store = new StateStore(root);
  return { root, store, tools: createTools(store) };
}

async function call(tools: VstackTool[], name: string, args: Record<string, unknown> = {}) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  const result = await tool.execute(args, {} as never);
  return JSON.parse(String(result.content));
}

async function open(tools: VstackTool[]) {
  const result = await call(tools, "vstack_route", {
    title: "fix the flaky test",
    tier: "standard",
    playbook: "fix-bug",
    outcome: "the flaky test passes 50/50",
    doneWhen: "50 consecutive runs exit 0",
    skills: ["debug", "tdd"],
    skipped: ["red-team"],
  });
  expect(result.ok).toBe(true);
  return result.delivery.id as string;
}

describe("six tools", () => {
  it("exposes exactly the six contracted names", () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "vstack_close",
      "vstack_decision",
      "vstack_evidence",
      "vstack_handoff",
      "vstack_route",
      "vstack_task",
    ]);
  });
});

describe("vstack_route", () => {
  it("opens a delivery and reads it back", async () => {
    const { tools } = setup();
    const id = await open(tools);
    const read = await call(tools, "vstack_route");
    expect(read.ok).toBe(true);
    expect(read.delivery.id).toBe(id);
    expect(read.delivery.phase).toBe("shape");
    expect(read.delivery.tier).toBe("standard");
  });

  it("refuses a second active delivery", async () => {
    const { tools } = setup();
    await open(tools);
    const second = await call(tools, "vstack_route", {
      title: "another",
      tier: "quick",
      playbook: "fix-bug",
      outcome: "x",
      doneWhen: "y",
    });
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe("ACTIVE_DELIVERY");
  });

  it("moves backward only with a reason", async () => {
    const { tools } = setup();
    await open(tools);
    const refused = await call(tools, "vstack_route", { phase: "route" });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("BACKWARD_REASON");
    const moved = await call(tools, "vstack_route", { phase: "route", reason: "re-route needed" });
    expect(moved.ok).toBe(true);
    expect(moved.delivery.phase).toBe("route");
  });
});

describe("vstack_task and vstack_evidence", () => {
  it("refuses completion without evidence", async () => {
    const { tools } = setup();
    await open(tools);
    const task = await call(tools, "vstack_task", {
      action: "add",
      title: "fix retry",
      check: "pnpm test -- retry",
    });
    expect(task.ok).toBe(true);
    await call(tools, "vstack_task", { action: "start", taskId: task.task.id });
    const refused = await call(tools, "vstack_task", {
      action: "complete",
      taskId: task.task.id,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("EVIDENCE_REQUIRED");
  });

  it("accepts completion only with passing evidence", async () => {
    const { tools } = setup();
    await open(tools);
    const task = await call(tools, "vstack_task", {
      action: "add",
      title: "fix retry",
      check: "pnpm test -- retry",
    });
    const failed = await call(tools, "vstack_evidence", {
      claim: "retry test passes",
      check: "pnpm test -- retry",
      result: "failed",
      taskId: task.task.id,
    });
    const refused = await call(tools, "vstack_task", {
      action: "complete",
      taskId: task.task.id,
      evidenceId: failed.evidence.id,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("EVIDENCE_NOT_PASSING");

    const passed = await call(tools, "vstack_evidence", {
      claim: "retry test passes",
      check: "pnpm test -- retry",
      result: "passed",
      taskId: task.task.id,
    });
    const done = await call(tools, "vstack_task", {
      action: "complete",
      taskId: task.task.id,
      evidenceId: passed.evidence.id,
    });
    expect(done.ok).toBe(true);
    expect(done.task.status).toBe("done");
  });
});

describe("vstack_close", () => {
  it("refuses open tasks and writes a record when complete", async () => {
    const { root, tools } = setup();
    const id = await open(tools);
    const task = await call(tools, "vstack_task", {
      action: "add",
      title: "fix retry",
      check: "pnpm test -- retry",
    });
    const refused = await call(tools, "vstack_close", { summary: "done" });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("OPEN_TASKS");

    const evidence = await call(tools, "vstack_evidence", {
      claim: "retry test passes",
      check: "pnpm test -- retry",
      result: "passed",
      taskId: task.task.id,
    });
    await call(tools, "vstack_task", {
      action: "complete",
      taskId: task.task.id,
      evidenceId: evidence.evidence.id,
    });
    const closed = await call(tools, "vstack_close", { summary: "retry fixed" });
    expect(closed.ok).toBe(true);
    expect(closed.delivery.status).toBe("closed");
    const record = join(root, ".vstack", "deliveries", `${id}.md`);
    expect(existsSync(record)).toBe(true);
    const text = readFileSync(record, "utf8");
    expect(text).toContain("fix the flaky test");
    expect(text).toContain("pnpm test -- retry");
    const archive = JSON.parse(readFileSync(join(root, ".vstack", "deliveries", `${id}.json`), "utf8"));
    expect(archive.id).toBe(id);
    expect(archive.status).toBe("closed");
  });

  it("keeps a closed delivery archived and allows the next one", async () => {
    const { root, tools } = setup();
    const first = await open(tools);
    const closed = await call(tools, "vstack_close", {
      waiver: { reason: "scope cut", owner: "owner" },
    });
    expect(closed.ok).toBe(true);

    const second = await call(tools, "vstack_route", {
      title: "second delivery",
      tier: "quick",
      playbook: "fix-bug",
      outcome: "second outcome",
      doneWhen: "second check",
    });
    expect(second.ok).toBe(true);
    expect(second.delivery.id).not.toBe(first);
    expect(existsSync(join(root, ".vstack", "deliveries", `${first}.json`))).toBe(true);
    expect(existsSync(join(root, ".vstack", "deliveries", `${first}.md`))).toBe(true);
  });

  it("closes with a waiver only when reason and owner are recorded", async () => {
    const { tools } = setup();
    await open(tools);
    await call(tools, "vstack_task", {
      action: "add",
      title: "unfinished",
      check: "true",
    });
    const refused = await call(tools, "vstack_close", {
      waiver: { reason: "deadline", owner: "" },
    });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("WAIVER_INCOMPLETE");
    const closed = await call(tools, "vstack_close", {
      waiver: { reason: "deadline", owner: "owner" },
    });
    expect(closed.ok).toBe(true);
    expect(closed.delivery.status).toBe("closed");
  });
});

describe("decision and handoff", () => {
  it("requires alternatives and a reason for a decision", async () => {
    const { tools } = setup();
    await open(tools);
    const refused = await call(tools, "vstack_decision", {
      choice: "queue",
      alternatives: "",
      reason: "retries",
      consequence: "one worker",
      owner: "owner",
    });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("INVALID_ARGUMENT");
    const ok = await call(tools, "vstack_decision", {
      choice: "queue",
      alternatives: "cron",
      reason: "cron loses retries",
      consequence: "one worker",
      owner: "owner",
    });
    expect(ok.ok).toBe(true);
  });

  it("requires a next action for a handoff", async () => {
    const { tools } = setup();
    await open(tools);
    const refused = await call(tools, "vstack_handoff", { state: "stuck" });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("INVALID_ARGUMENT");
    const ok = await call(tools, "vstack_handoff", {
      state: "stuck",
      nextAction: "run the repro",
      blockers: ["staging down"],
      treeStatus: "clean",
    });
    expect(ok.ok).toBe(true);
  });
});
