import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StateStore } from "../src/state/store.js";
import { createTools, type VstackTool } from "../src/tools/index.js";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "vstack-walkthrough-"));
  return { root, tools: createTools(new StateStore(root)) };
}

async function call(tools: VstackTool[], name: string, args: Record<string, unknown> = {}) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`missing ${name}`);
  return JSON.parse(String((await tool.execute(args, {} as never)).content));
}

async function open(tools: VstackTool[], playbook: string, title: string) {
  const result = await call(tools, "vstack_route", {
    title,
    tier: "standard",
    playbook,
    outcome: `${playbook} outcome`,
    doneWhen: `${playbook} check passes`,
  });
  expect(result.ok).toBe(true);
  return result.delivery.id as string;
}

async function finish(tools: VstackTool[], task: string, check: string, claim: string) {
  const added = await call(tools, "vstack_task", { action: "add", title: task, check });
  await call(tools, "vstack_task", { action: "start", taskId: added.task.id });
  const evidence = await call(tools, "vstack_evidence", { claim, check, result: "passed" });
  await call(tools, "vstack_task", {
    action: "complete",
    taskId: added.task.id,
    evidenceId: evidence.evidence.id,
  });
}

describe("golden walkthroughs", () => {
  it("build-feature closes with a readable record", async () => {
    const { root, tools } = setup();
    const id = await open(tools, "build-feature", "add request retry");
    await finish(tools, "write retry test", "pnpm test -- retry", "retry test passes");
    const closed = await call(tools, "vstack_close", { summary: "retry shipped" });
    expect(closed.ok).toBe(true);
    const text = readFileSync(join(root, ".vstack", "deliveries", `${id}.md`), "utf8");
    expect(text).toContain("add request retry");
    expect(text).toContain("retry test passes");
  });

  it("fix-bug refuses failed evidence and closes after a pass", async () => {
    const { root, tools } = setup();
    const id = await open(tools, "fix-bug", "fix flaky login");
    const added = await call(tools, "vstack_task", {
      action: "add",
      title: "reproduce",
      check: "pnpm test -- login",
    });
    const failed = await call(tools, "vstack_evidence", {
      claim: "reproduces",
      check: "pnpm test -- login",
      result: "failed",
    });
    const refused = await call(tools, "vstack_task", {
      action: "complete",
      taskId: added.task.id,
      evidenceId: failed.evidence.id,
    });
    expect(refused.error.code).toBe("EVIDENCE_NOT_PASSING");

    const passed = await call(tools, "vstack_evidence", {
      claim: "login passes",
      check: "pnpm test -- login",
      result: "passed",
    });
    await call(tools, "vstack_task", {
      action: "complete",
      taskId: added.task.id,
      evidenceId: passed.evidence.id,
    });
    const closed = await call(tools, "vstack_close", {});
    expect(closed.ok).toBe(true);
    expect(existsSync(join(root, ".vstack", "deliveries", `${id}.json`))).toBe(true);
  });

  it("deliver records a decision and handoff", async () => {
    const { tools } = setup();
    await open(tools, "deliver", "release 0.2.0");
    await finish(tools, "run release checks", "docker/test.sh all", "all checks pass");
    const decision = await call(tools, "vstack_decision", {
      choice: "tag after checks",
      alternatives: "tag before checks",
      reason: "no claim before an artifact",
      consequence: "release waits for green",
      owner: "owner",
    });
    expect(decision.ok).toBe(true);
    await call(tools, "vstack_handoff", {
      state: "checks green",
      nextAction: "tag v0.2.0",
      blockers: [],
      treeStatus: "clean",
    });
    const closed = await call(tools, "vstack_close", {});
    expect(closed.delivery.decisions).toHaveLength(1);
    expect(closed.delivery.handoffs[0].nextAction).toBe("tag v0.2.0");
  });

  it("migrate records two evidenced tasks", async () => {
    const { tools } = setup();
    await open(tools, "migrate", "move state to v1");
    await finish(tools, "write migration", "pnpm migrate --dry-run", "dry run passes");
    await finish(tools, "run migration", "pnpm migrate", "migration exits 0");
    const closed = await call(tools, "vstack_close", {});
    expect(closed.ok).toBe(true);
    expect(closed.delivery.tasks.every((task: { status: string }) => task.status === "done")).toBe(true);
  });
});
