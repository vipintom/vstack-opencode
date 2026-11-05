import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state/store.js";
import { VstackService } from "../src/service.js";
import { createTools, type VstackTool } from "../src/tools/index.js";

function setup(gates: Array<{ id: string; kind: string }> = [{ id: "g_cmd", kind: "command" }]) {
  const root = mkdtempSync(join(tmpdir(), "vstack-v2-"));
  const store = new StateStore(root);
  const tools = createTools(store);
  return { root, store, service: new VstackService(store), tools };
}

async function call(tools: VstackTool[], name: string, args: Record<string, unknown> = {}) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`missing tool ${name}`);
  return JSON.parse(String((await tool.execute(args, {} as never)).content));
}

async function open(tools: VstackTool[], gates: Array<{ id: string; kind: string }> = [{ id: "g_cmd", kind: "command" }]) {
  const result = await call(tools, "vstack_route", {
    title: "v2 delivery",
    tier: "standard",
    playbook: "fix-bug",
    outcome: "done",
    doneWhen: "checks pass",
    gates,
  });
  expect(result.ok).toBe(true);
  return result.delivery.id as string;
}

describe("recorder v2", () => {
  it("writes schemaVersion 2 on open", async () => {
    const { store, tools } = setup();
    await open(tools);
    const state = await store.read();
    expect(state?.schemaVersion).toBe(2);
    expect(state?.delivery?.gates).toEqual([{ id: "g_cmd", kind: "command" }]);
  });

  it("refuses duplicate gate ids at open", async () => {
    const { tools } = setup();
    const result = await call(tools, "vstack_route", {
      title: "dup gates",
      tier: "quick",
      playbook: "fix-bug",
      outcome: "x",
      doneWhen: "y",
      gates: [
        { id: "g_dup", kind: "command" },
        { id: "g_dup", kind: "artifact" },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GATE_DUPLICATE");
  });

  it("refuses an unknown gate kind at open", async () => {
    const { tools } = setup();
    const result = await call(tools, "vstack_route", {
      title: "bad kind",
      tier: "quick",
      playbook: "fix-bug",
      outcome: "x",
      doneWhen: "y",
      gates: [{ id: "g_bad", kind: "shell" }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INVALID_ARGUMENT");
  });

  it("completes a task with inline evidence in one call", async () => {
    const { tools } = setup();
    await open(tools);
    const task = await call(tools, "vstack_task", {
      action: "add",
      title: "inline",
      check: "true",
      gateId: "g_cmd",
    });
    const done = await call(tools, "vstack_task", {
      action: "complete",
      taskId: task.task.id,
      evidence: { claim: "inline passes", check: "true", result: "passed", gateId: "g_cmd" },
    });
    expect(done.ok).toBe(true);
    expect(done.task.status).toBe("done");
    expect(done.evidence.taskId).toBe(task.task.id);
    expect(done.evidence.gateId).toBe("g_cmd");
  });

  it("refuses completion with no gate linked when gates are declared", async () => {
    const { tools } = setup();
    await open(tools);
    const task = await call(tools, "vstack_task", { action: "add", title: "ungated", check: "true" });
    const evidence = await call(tools, "vstack_evidence", {
      claim: "ungated passes",
      check: "true",
      result: "passed",
      taskId: task.task.id,
    });
    expect(evidence.ok).toBe(true);
    const refused = await call(tools, "vstack_task", {
      action: "complete",
      taskId: task.task.id,
      evidenceId: evidence.evidence.id,
    });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("GATE_REQUIRED");
  });

  it("refuses an unknown gateId on task add and evidence record", async () => {
    const { tools } = setup();
    await open(tools);
    const badTask = await call(tools, "vstack_task", {
      action: "add",
      title: "bad gate",
      check: "true",
      gateId: "g_nope",
    });
    expect(badTask.ok).toBe(false);
    expect(badTask.error.code).toBe("GATE_UNKNOWN");
    const badEvidence = await call(tools, "vstack_evidence", {
      claim: "x",
      check: "true",
      result: "passed",
      gateId: "g_nope",
    });
    expect(badEvidence.ok).toBe(false);
    expect(badEvidence.error.code).toBe("GATE_UNKNOWN");
  });

  it("hashes artifact files and refuses close on digest mismatch", async () => {
    const { root, tools } = setup();
    await open(tools);
    const artifact = "report.txt";
    writeFileSync(join(root, artifact), "version one", "utf8");
    const task = await call(tools, "vstack_task", {
      action: "add",
      title: "artifact task",
      check: "cat report.txt",
      gateId: "g_cmd",
    });
    const evidence = await call(tools, "vstack_evidence", {
      claim: "report captured",
      check: "cat report.txt",
      result: "passed",
      artifact,
      gateId: "g_cmd",
      taskId: task.task.id,
    });
    expect(evidence.ok).toBe(true);
    const expected = createHash("sha256").update("version one").digest("hex");
    expect(evidence.evidence.digest).toBe(expected);
    await call(tools, "vstack_task", {
      action: "complete",
      taskId: task.task.id,
      evidenceId: evidence.evidence.id,
    });
    writeFileSync(join(root, artifact), "version two", "utf8");
    const refused = await call(tools, "vstack_close", { summary: "tampered" });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("DIGEST_MISMATCH");
  });

  it("imports N tasks from checklist text", async () => {
    const { tools } = setup();
    await open(tools);
    const imported = await call(tools, "vstack_task", {
      action: "import",
      gateId: "g_cmd",
      text: "- [ ] first thing — check: `true`\n- [ ] second thing\nnot a task\n- [ ] third thing — check: `pnpm test`",
    });
    expect(imported.ok).toBe(true);
    expect(imported.tasks).toHaveLength(3);
    expect(imported.tasks[0].check).toBe("true");
    expect(imported.tasks[1].check).toBe("second thing");
    expect(imported.tasks[2].check).toBe("pnpm test");
    expect(imported.tasks.every((t: { gateId: string }) => t.gateId === "g_cmd")).toBe(true);
  });

  it("invalidates the session cache on write", async () => {
    const root = mkdtempSync(join(tmpdir(), "vstack-v2cache-"));
    const store = new StateStore(root);
    const service = new VstackService(store);
    await service.route({
      title: "cache",
      tier: "standard",
      playbook: "fix-bug",
      outcome: "done",
      doneWhen: "checks pass",
      gates: [],
    });
    const before = await service.cachedState();
    expect(before?.delivery?.tasks).toHaveLength(0);
    await service.task({ action: "add", title: "cached", check: "true" });
    const after = await service.cachedState();
    expect(after?.delivery?.tasks).toHaveLength(1);
    expect(after?.delivery?.tasks[0]?.title).toBe("cached");
  });

  it("refuses a v1 state file without migrating", async () => {
    const { store, tools } = setup();
    await open(tools);
    const raw = JSON.parse(
      (await import("node:fs")).readFileSync(store.statePath, "utf8")
    );
    raw.schemaVersion = 1;
    delete raw.delivery.gates;
    writeFileSync(store.statePath, JSON.stringify(raw), "utf8");
    await expect(store.read()).rejects.toMatchObject({ code: "STATE_VERSION_MISMATCH" });
  });

  it("refuses an archived delivery without v2 fields", async () => {
    const { store, tools } = setup();
    const id = await open(tools);
    await call(tools, "vstack_close", { summary: "done" });
    const path = join(store.root, ".vstack", "deliveries", `${id}.json`);
    const raw = JSON.parse((await import("node:fs")).readFileSync(path, "utf8"));
    delete raw.gates;
    writeFileSync(path, JSON.stringify(raw), "utf8");
    await expect(store.readDelivery(id)).rejects.toMatchObject({ code: "STATE_VERSION_MISMATCH" });
  });

  it("requires diffRange and reviewer evidence for a review close", async () => {
    const { tools } = setup();
    await open(tools, [
      { id: "g_cmd", kind: "command" },
      { id: "g_rev", kind: "review" },
    ]);
    const reviewer = await call(tools, "vstack_evidence", {
      claim: "reviewed",
      check: "git diff",
      result: "passed",
      gateId: "g_rev",
    });
    const missing = await call(tools, "vstack_close", {
      review: { outcome: "approved", owner: "reviewer" },
    });
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("REVIEW_INCOMPLETE");
    const ok = await call(tools, "vstack_close", {
      review: {
        outcome: "approved",
        owner: "reviewer",
        diffRange: "abc..def",
        reviewerEvidenceId: reviewer.evidence.id,
      },
    });
    expect(ok.ok).toBe(true);
    expect(ok.delivery.close.diffRange).toBe("abc..def");
  });

  it("requires a review when review-kind evidence exists", async () => {
    const { tools } = setup();
    await open(tools, [
      { id: "g_cmd", kind: "command" },
      { id: "g_rev", kind: "review" },
    ]);
    await call(tools, "vstack_evidence", {
      claim: "reviewed",
      check: "git diff",
      result: "passed",
      gateId: "g_rev",
    });
    const refused = await call(tools, "vstack_close", { summary: "no review" });
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe("REVIEW_INCOMPLETE");
  });
});
