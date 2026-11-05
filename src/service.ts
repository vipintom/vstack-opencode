import { StateStore } from "./state/store.js";
import type {
  Delivery,
  Evidence,
  EvidenceResult,
  Phase,
  State,
  Task,
  Tier,
} from "./state/types.js";
import { VstackError } from "./state/types.js";

const PHASES: Phase[] = ["route", "shape", "plan", "build", "prove", "review", "close"];
const RESULTS: EvidenceResult[] = ["passed", "failed", "blocked", "not_verified", "judgement"];

function now(): string {
  return new Date().toISOString();
}

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VstackError("INVALID_ARGUMENT", `${key} is required and must be a non-empty string`);
  }
  return value.trim();
}

function maybeStr(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new VstackError("INVALID_ARGUMENT", `${key} must be a string`);
  return value;
}

function strArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new VstackError("INVALID_ARGUMENT", `${key} must be an array of strings`);
  }
  return value as string[];
}

function nextNumber(ids: string[], prefix: string): number {
  return ids.reduce((max, id) => {
    const value = Number(id.slice(prefix.length));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, ids.length) + 1;
}

function active(state: State | null): Delivery {
  if (!state?.delivery) throw new VstackError("NO_DELIVERY", "open a delivery with vstack_route first");
  if (state.delivery.status === "closed") {
    throw new VstackError("NO_ACTIVE_DELIVERY", "the delivery is closed; open a new one");
  }
  return state.delivery;
}

function findTask(delivery: Delivery, taskId: string): Task {
  const task = delivery.tasks.find((t) => t.id === taskId);
  if (!task) throw new VstackError("TASK_NOT_FOUND", `no task ${taskId}`);
  return task;
}

function closeMarkdown(delivery: Delivery, summary: string): string {
  const taskLines = delivery.tasks.map((task) => {
    const box = task.status === "done" ? "x" : " ";
    const evidence = task.evidenceId ? ` — evidence ${task.evidenceId}` : "";
    return `- [${box}] ${task.title} — check: \`${task.check}\`${evidence}`;
  });
  const evidenceLines = delivery.evidence.map(
    (item) => `- ${item.id} **${item.result}** — ${item.claim} (check: \`${item.check}\`${item.artifact ? `, artifact: ${item.artifact}` : ""})`
  );
  const decisionLines = delivery.decisions.map(
    (item) => `- ${item.choice} — ${item.reason}. Rejected: ${item.alternatives}. Consequence: ${item.consequence} (${item.owner})`
  );
  const lastHandoff = delivery.handoffs.at(-1);
  const waiver = delivery.close?.waiver;
  return `# ${delivery.title}

- Delivery: ${delivery.id}
- Tier: ${delivery.tier}
- Playbook: ${delivery.playbook}
- Closed: ${delivery.closedAt ?? now()}

## Outcome

${delivery.outcome}

Done when: ${delivery.doneWhen}

## Summary

${summary || "No summary recorded."}

## Tasks

${taskLines.join("\n") || "No tasks recorded."}

## Evidence

${evidenceLines.join("\n") || "No evidence recorded."}

## Decisions

${decisionLines.join("\n") || "No decisions recorded."}

## Handoff

${lastHandoff ? `${lastHandoff.state} → ${lastHandoff.nextAction}${lastHandoff.blockers.length ? ` (blocked: ${lastHandoff.blockers.join(", ")})` : ""}` : "No handoff recorded."}

${waiver ? `## Waiver\n\nAccepted by ${waiver.owner}: ${waiver.reason}\n` : ""}`;
}

export class VstackService {
  constructor(private readonly store: StateStore) {}

  async route(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (args.title === undefined && args.phase === undefined) {
      const state = await this.store.read();
      if (!state?.delivery) throw new VstackError("NO_DELIVERY", "no delivery is open");
      return { ok: true, delivery: state.delivery };
    }

    if (args.title !== undefined) {
      const state = await this.store.read();
      if (state?.delivery?.status === "active" || state?.delivery?.status === "parked") {
        throw new VstackError("ACTIVE_DELIVERY", "close or park the active delivery before opening another");
      }
      const title = str(args, "title");
      const tier = str(args, "tier") as Tier;
      if (!["quick", "standard", "deep"].includes(tier)) {
        throw new VstackError("INVALID_ARGUMENT", "tier must be quick, standard or deep");
      }
      const ts = now();
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "delivery";
      const delivery: Delivery = {
        id: `dlv_${Date.now().toString(36)}_${slug}`,
        title,
        tier,
        playbook: str(args, "playbook"),
        phase: "shape",
        status: "active",
        outcome: str(args, "outcome"),
        doneWhen: str(args, "doneWhen"),
        skills: strArray(args, "skills"),
        skipped: strArray(args, "skipped"),
        tasks: [],
        evidence: [],
        decisions: [],
        handoffs: [],
        createdAt: ts,
        updatedAt: ts,
        closedAt: null,
      };
      await this.store.transaction((state) => {
        state.delivery = delivery;
        return { result: null, event: { type: "delivery.opened", data: { playbook: delivery.playbook, tier } } };
      });
      return { ok: true, delivery };
    }

    const phase = str(args, "phase") as Phase;
    if (!PHASES.includes(phase)) throw new VstackError("INVALID_ARGUMENT", "unknown phase");
    return this.store.transaction((state) => {
      const delivery = active(state);
      const fromIndex = PHASES.indexOf(delivery.phase);
      const toIndex = PHASES.indexOf(phase);
      const reason = maybeStr(args, "reason");
      if (toIndex < fromIndex && !reason) {
        throw new VstackError("BACKWARD_REASON", "moving backward requires a reason");
      }
      delivery.phase = phase;
      delivery.updatedAt = now();
      state.updatedAt = delivery.updatedAt;
      return {
        result: { ok: true, delivery },
        event: { type: "phase.changed", data: { from: PHASES[fromIndex], to: phase, reason } },
      };
    });
  }

  async task(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = str(args, "action");
    return this.store.transaction((state) => {
      const delivery = active(state);
      if (action === "add") {
        const ts = now();
        const task: Task = {
          id: `tsk_${nextNumber(delivery.tasks.map((t) => t.id), "tsk_")}`,
          title: str(args, "title"),
          status: "todo",
          check: str(args, "check"),
          evidenceId: null,
          artifact: maybeStr(args, "artifact"),
          createdAt: ts,
          updatedAt: ts,
        };
        delivery.tasks.push(task);
        delivery.updatedAt = ts;
        return { result: { ok: true, task }, event: { type: "task.added", data: { id: task.id } } };
      }

      const task = findTask(delivery, str(args, "taskId"));
      const ts = now();
      if (action === "start") {
        task.status = "doing";
        task.updatedAt = ts;
        delivery.updatedAt = ts;
        return { result: { ok: true, task }, event: { type: "task.started", data: { id: task.id } } };
      }
      if (action !== "complete") throw new VstackError("INVALID_ARGUMENT", `unknown action ${action}`);

      const evidenceId = maybeStr(args, "evidenceId");
      if (!evidenceId) {
        throw new VstackError("EVIDENCE_REQUIRED", "completion requires an existing evidence id");
      }
      const evidence = delivery.evidence.find((e) => e.id === evidenceId);
      if (!evidence) throw new VstackError("EVIDENCE_REQUIRED", "completion requires an existing evidence id");
      if (evidence.result !== "passed" && evidence.result !== "judgement") {
        throw new VstackError("EVIDENCE_NOT_PASSING", `evidence ${evidenceId} is ${evidence.result}, not passed`);
      }
      task.status = "done";
      task.evidenceId = evidenceId;
      task.artifact = maybeStr(args, "artifact") ?? task.artifact;
      task.updatedAt = ts;
      delivery.updatedAt = ts;
      return {
        result: { ok: true, task },
        event: { type: "task.completed", data: { id: task.id, evidenceId } },
      };
    });
  }

  async evidence(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.store.transaction((state) => {
      const delivery = active(state);
      const result = str(args, "result") as EvidenceResult;
      if (!RESULTS.includes(result)) {
        throw new VstackError("INVALID_ARGUMENT", "result must be passed, failed, blocked, not_verified or judgement");
      }
      const taskId = maybeStr(args, "taskId");
      if (taskId) findTask(delivery, taskId);
      const item: Evidence = {
        id: `ev_${nextNumber(delivery.evidence.map((e) => e.id), "ev_")}`,
        claim: str(args, "claim"),
        check: str(args, "check"),
        result,
        artifact: maybeStr(args, "artifact"),
        createdAt: now(),
      };
      delivery.evidence.push(item);
      delivery.updatedAt = item.createdAt;
      return {
        result: { ok: true, evidence: item, taskId },
        event: { type: "evidence.recorded", data: { id: item.id, result, taskId } },
      };
    });
  }

  async decision(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.store.transaction((state) => {
      const delivery = active(state);
      const item = {
        id: `dec_${nextNumber(delivery.decisions.map((d) => d.id), "dec_")}`,
        choice: str(args, "choice"),
        alternatives: str(args, "alternatives"),
        reason: str(args, "reason"),
        consequence: str(args, "consequence"),
        owner: str(args, "owner"),
        createdAt: now(),
      };
      delivery.decisions.push(item);
      delivery.updatedAt = item.createdAt;
      return { result: { ok: true, decision: item }, event: { type: "decision.recorded", data: { id: item.id } } };
    });
  }

  async handoff(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.store.transaction((state) => {
      const delivery = active(state);
      const item = {
        id: `hnd_${nextNumber(delivery.handoffs.map((h) => h.id), "hnd_")}`,
        state: str(args, "state"),
        nextAction: str(args, "nextAction"),
        blockers: strArray(args, "blockers"),
        treeStatus: maybeStr(args, "treeStatus") ?? "unknown",
        createdAt: now(),
      };
      delivery.handoffs.push(item);
      delivery.updatedAt = item.createdAt;
      return { result: { ok: true, handoff: item }, event: { type: "handoff.recorded", data: { id: item.id } } };
    });
  }

  async close(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.store.transaction((state) => {
      const delivery = active(state);
      const waiverRaw = args.waiver;
      let waiver: { reason: string; owner: string } | null = null;
      if (waiverRaw !== undefined) {
        const value = waiverRaw as Record<string, unknown>;
        const reason = typeof value.reason === "string" ? value.reason.trim() : "";
        const owner = typeof value.owner === "string" ? value.owner.trim() : "";
        if (!reason || !owner) throw new VstackError("WAIVER_INCOMPLETE", "a waiver needs a reason and an owner");
        waiver = { reason, owner };
      }
      const open = delivery.tasks.filter((task) => task.status !== "done");
      if (open.length > 0 && !waiver) {
        throw new VstackError("OPEN_TASKS", `open tasks: ${open.map((task) => task.id).join(", ")}`);
      }
      for (const task of delivery.tasks.filter((task) => task.status === "done")) {
        if (!task.evidenceId) throw new VstackError("EVIDENCE_REQUIRED", `task ${task.id} has no evidence`);
        if (!delivery.evidence.some((item) => item.id === task.evidenceId)) {
          throw new VstackError("EVIDENCE_REQUIRED", `task ${task.id} references missing evidence`);
        }
      }
      const closedAt = now();
      const summary = maybeStr(args, "summary") ?? "";
      delivery.status = "closed";
      delivery.phase = "close";
      delivery.closedAt = closedAt;
      delivery.updatedAt = closedAt;
      delivery.close = {
        recordPath: `.vstack/deliveries/${delivery.id}.md`,
        summary,
        waiver,
        closedAt,
      };
      this.store.writeDelivery(delivery, closeMarkdown(delivery, summary));
      return {
        result: { ok: true, delivery },
        event: { type: "delivery.closed", data: { record: delivery.close.recordPath, waived: Boolean(waiver) } },
      };
    });
  }
}
