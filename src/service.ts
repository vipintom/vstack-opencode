import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { StateStore } from "./state/store.js";
import type {
  Delivery,
  Evidence,
  EvidenceResult,
  Gate,
  GateKind,
  HistoryEventType,
  Phase,
  State,
  Task,
  Tier,
} from "./state/types.js";
import { VstackError } from "./state/types.js";

const PHASES: Phase[] = ["route", "shape", "plan", "build", "prove", "review", "close"];
const RESULTS: EvidenceResult[] = ["passed", "failed", "blocked", "not_verified", "judgement"];
const KINDS: GateKind[] = ["command", "artifact", "review"];
const GATE_ID = /^[a-zA-Z_]+[a-zA-Z0-9_-]*$/;

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
  }, 0) + 1;
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

function parseGates(raw: unknown): Gate[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new VstackError("INVALID_ARGUMENT", "gates must be an array");
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new VstackError("INVALID_ARGUMENT", `gates/${index} must be an object`);
    }
    const gate = entry as Record<string, unknown>;
    const id = typeof gate.id === "string" ? gate.id.trim() : "";
    const kind = typeof gate.kind === "string" ? gate.kind : "";
    if (!id || !GATE_ID.test(id)) throw new VstackError("INVALID_ARGUMENT", `gates/${index}/id is invalid`);
    if (!KINDS.includes(kind as GateKind)) {
      throw new VstackError("INVALID_ARGUMENT", `gates/${index}/kind must be command, artifact or review`);
    }
    if (seen.has(id)) throw new VstackError("GATE_DUPLICATE", `duplicate gate id ${id}`);
    seen.add(id);
    return { id, kind: kind as GateKind };
  });
}

function checkGateId(delivery: Delivery, gateId: string | null | undefined): string | null {
  if (gateId === undefined || gateId === null || gateId === "") return null;
  if (!delivery.gates.some((g) => g.id === gateId)) {
    throw new VstackError("GATE_UNKNOWN", `unknown gate ${gateId}`);
  }
  return gateId;
}

function digestFor(root: string, artifact: string | null): string | null {
  if (!artifact) return null;
  try {
    const path = isAbsolute(artifact) ? artifact : join(root, artifact);
    if (!existsSync(path)) return null;
    if (statSync(path).isDirectory()) return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

function parseImportText(text: string): Array<{ title: string; check: string }> {
  const tasks: Array<{ title: string; check: string }> = [];
  for (const line of text.split("\n")) {
    const match = /^\s*-\s*\[[ xX]?\]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const body = match[1]!.trim();
    if (!body) continue;
    const checkMatch = /^(.*?)\s+[—–-]+\s*check:\s*`([^`]+)`\s*$/.exec(body);
    if (checkMatch) {
      tasks.push({ title: checkMatch[1]!.trim() || body, check: checkMatch[2]!.trim() });
    } else {
      tasks.push({ title: body, check: body });
    }
  }
  return tasks;
}

function recordMarkdown(delivery: Delivery, summary: string): string {
  const taskLines = delivery.tasks.map((task) => {
    const box = task.status === "done" ? "x" : " ";
    const evidence = task.evidenceId ? ` — evidence ${task.evidenceId}` : "";
    return `- [${box}] ${task.title} — check: \`${task.check}\`${evidence}`;
  });
  const evidenceLines = delivery.evidence.map(
    (item) => `- ${item.id} **${item.result}** — ${item.claim} (check: \`${item.check}\`${item.artifact ? `, artifact: ${item.artifact}` : ""}${item.digest ? `, digest: ${item.digest.slice(0, 12)}` : ""}${item.gateId ? `, gate: ${item.gateId}` : ""}${item.taskId ? `, task: ${item.taskId}` : ""})`
  );
  const decisionLines = delivery.decisions.map(
    (item) => `- ${item.choice} — ${item.reason}. Rejected: ${item.alternatives}. Consequence: ${item.consequence} (${item.owner})`
  );
  const lastHandoff = delivery.handoffs.at(-1);
  const waiver = delivery.close?.waiver;
  const review = delivery.close?.review;
  return `# ${delivery.title}

- Delivery: ${delivery.id}
- Tier: ${delivery.tier}
- Playbook: ${delivery.playbook}
- Status: ${delivery.status}
- Closed: ${delivery.closedAt ?? "not closed"}

## Outcome

${delivery.outcome}

Done when: ${delivery.doneWhen}

## Summary

${summary || "No summary recorded."}

## Review

${review ? `${review.outcome} — ${review.notes || "no notes"} (${review.owner})` : "No review outcome recorded."}

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
  private cached: State | null | undefined = undefined;

  constructor(private readonly store: StateStore) {}

  /** Last-read state. Invalidated on every write transaction. */
  async cachedState(): Promise<State | null> {
    if (this.cached !== undefined) return this.cached;
    const state = await this.store.read();
    this.cached = state;
    return state;
  }

  private async runTransaction<T>(
    fn: (state: State) => { result: T; event?: { type: HistoryEventType; data: Record<string, unknown>; deliveryId?: string } }
  ): Promise<T> {
    try {
      return await this.store.transaction(fn);
    } finally {
      this.cached = undefined;
    }
  }

  async route(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const action = maybeStr(args, "action");
    if (action === "read" || (action === null && args.title === undefined && args.phase === undefined)) {
      const state = await this.cachedState();
      return { ok: true, delivery: state?.delivery ?? null };
    }

    if (action === "park") {
      return this.runTransaction((state) => {
        const delivery = active(state);
        if (delivery.status !== "active") {
          throw new VstackError("DELIVERY_NOT_ACTIVE", `delivery ${delivery.id} is ${delivery.status}`);
        }
        delivery.status = "parked";
        delivery.updatedAt = now();
        state.delivery = null;
        state.updatedAt = delivery.updatedAt;
        this.store.writeDelivery(delivery, recordMarkdown(delivery, "Parked. Resume with vstack_route action=resume."));
        return {
          result: { ok: true, delivery },
          event: {
            type: "delivery.parked",
            data: { id: delivery.id, reason: maybeStr(args, "reason") },
            deliveryId: delivery.id,
          },
        };
      });
    }

    if (action === "resume") {
      const id = str(args, "id");
      const current = await this.cachedState();
      if (current?.delivery?.status === "active" || current?.delivery?.status === "parked") {
        throw new VstackError("ACTIVE_DELIVERY", "close or park the current delivery before resuming another");
      }
      // Fast-fail pre-check; authoritative read happens inside the lock below.
      const precheck = await this.store.readDelivery(id);
      if (precheck.status !== "parked") {
        throw new VstackError("DELIVERY_NOT_PARKED", `delivery ${id} is ${precheck.status}, not parked`);
      }
      return this.runTransaction((state) => {
        if (state.delivery?.status === "active" || state.delivery?.status === "parked") {
          throw new VstackError("ACTIVE_DELIVERY", "close or park the current delivery before resuming another");
        }
        // Re-read inside the lock so a concurrent park/close cannot slip a stale snapshot in.
        const parked = this.store.readDeliverySync(id);
        if (parked.status !== "parked") {
          throw new VstackError("DELIVERY_NOT_PARKED", `delivery ${id} is ${parked.status}, not parked`);
        }
        parked.status = "active";
        parked.updatedAt = now();
        state.delivery = parked;
        state.updatedAt = parked.updatedAt;
        return {
          result: { ok: true, delivery: parked },
          event: {
            type: "delivery.resumed",
            data: { id: parked.id },
            deliveryId: parked.id,
          },
        };
      });
    }

    if (action === "open" || args.title !== undefined) {
      const current = await this.cachedState();
      if (current?.delivery?.status === "active" || current?.delivery?.status === "parked") {
        throw new VstackError("ACTIVE_DELIVERY", "close or park the active delivery before opening another");
      }
      const title = str(args, "title");
      const tier = str(args, "tier") as Tier;
      if (!["quick", "standard", "deep"].includes(tier)) {
        throw new VstackError("INVALID_ARGUMENT", "tier must be quick, standard or deep");
      }
      const gates = parseGates(args.gates);
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
        gates,
        skipped: strArray(args, "skipped"),
        tasks: [],
        evidence: [],
        decisions: [],
        handoffs: [],
        createdAt: ts,
        updatedAt: ts,
        closedAt: null,
      };
      await this.runTransaction((state) => {
        state.delivery = delivery;
        return {
          result: null,
          event: {
            type: "delivery.opened",
            data: { id: delivery.id, title: delivery.title, playbook: delivery.playbook, tier },
          },
        };
      });
      return { ok: true, delivery };
    }

    if (action !== null && action !== "phase") {
      throw new VstackError("INVALID_ARGUMENT", `unknown route action ${action}`);
    }
    const phase = str(args, "phase") as Phase;
    if (!PHASES.includes(phase)) throw new VstackError("INVALID_ARGUMENT", "unknown phase");
    return this.runTransaction((state) => {
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
    if (action === "import") {
      const text = str(args, "text");
      const gateIdRaw = maybeStr(args, "gateId");
      return this.runTransaction((state) => {
        const delivery = active(state);
        const gateId = gateIdRaw ? checkGateId(delivery, gateIdRaw) : null;
        const parsed = parseImportText(text);
        if (parsed.length === 0) throw new VstackError("INVALID_ARGUMENT", "text has no `- [ ] title` lines");
        const ts = now();
        let n = nextNumber(delivery.tasks.map((t) => t.id), "tsk_");
        const created: Task[] = parsed.map((entry) => ({
          id: `tsk_${n++}`,
          title: entry.title,
          status: "todo" as const,
          check: entry.check,
          evidenceId: null,
          artifact: null,
          gateId,
          createdAt: ts,
          updatedAt: ts,
        }));
        delivery.tasks.push(...created);
        delivery.updatedAt = ts;
        state.updatedAt = ts;
        return {
          result: { ok: true, tasks: created },
          event: { type: "task.imported", data: { count: created.length } },
        };
      });
    }

    return this.runTransaction<{ ok: boolean; task: Task; evidence?: Evidence }>((state) => {
      const delivery = active(state);
      if (action === "add") {
        const ts = now();
        const gateIdRaw = maybeStr(args, "gateId");
        const gateId = gateIdRaw ? checkGateId(delivery, gateIdRaw) : null;
        const task: Task = {
          id: `tsk_${nextNumber(delivery.tasks.map((t) => t.id), "tsk_")}`,
          title: str(args, "title"),
          status: "todo",
          check: str(args, "check"),
          evidenceId: null,
          artifact: maybeStr(args, "artifact"),
          gateId,
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

      const inlineRaw = args.evidence;
      let evidence: Evidence | undefined;
      let evidenceId = maybeStr(args, "evidenceId");
      if (inlineRaw !== undefined && inlineRaw !== null) {
        if (typeof inlineRaw !== "object" || Array.isArray(inlineRaw)) {
          throw new VstackError("INVALID_ARGUMENT", "evidence must be an object");
        }
        const inline = inlineRaw as Record<string, unknown>;
        const result = typeof inline.result === "string" ? inline.result : "";
        if (!RESULTS.includes(result as EvidenceResult)) {
          throw new VstackError("INVALID_ARGUMENT", "result must be passed, failed, blocked, not_verified or judgement");
        }
        const inlineGateRaw =
          inline.gateId === undefined || inline.gateId === null ? null : String(inline.gateId);
        const inlineGateId = inlineGateRaw ? checkGateId(delivery, inlineGateRaw) : null;
        const artifact =
          inline.artifact === undefined || inline.artifact === null ? null : String(inline.artifact);
        evidence = {
          id: `ev_${nextNumber(delivery.evidence.map((e) => e.id), "ev_")}`,
          claim: typeof inline.claim === "string" && inline.claim.trim() ? inline.claim.trim() : (() => { throw new VstackError("INVALID_ARGUMENT", "claim is required and must be a non-empty string"); })(),
          check: typeof inline.check === "string" && inline.check.trim() ? inline.check.trim() : (() => { throw new VstackError("INVALID_ARGUMENT", "check is required and must be a non-empty string"); })(),
          result: result as EvidenceResult,
          artifact,
          gateId: inlineGateId,
          digest: digestFor(this.store.root, artifact),
          taskId: task.id,
          createdAt: now(),
        };
        delivery.evidence.push(evidence);
        evidenceId = evidence.id;
      } else {
        if (!evidenceId) {
          throw new VstackError("EVIDENCE_REQUIRED", "completion requires an existing evidence id or an inline evidence object");
        }
        const found = delivery.evidence.find((e) => e.id === evidenceId);
        if (!found) throw new VstackError("EVIDENCE_REQUIRED", "completion requires an existing evidence id");
        evidence = found;
      }
      if (!evidence || !evidenceId) throw new VstackError("EVIDENCE_REQUIRED", "completion requires evidence");
      if (evidence.taskId !== task.id) {
        throw new VstackError("EVIDENCE_MISMATCH", `evidence ${evidenceId} belongs to task ${evidence.taskId ?? "none"}`);
      }
      if (evidence.result !== "passed" && evidence.result !== "judgement") {
        throw new VstackError("EVIDENCE_NOT_PASSING", `evidence ${evidenceId} is ${evidence.result}, not passed`);
      }
      const linkedGate = evidence.gateId ?? task.gateId ?? null;
      if (delivery.gates.length > 0 && !linkedGate) {
        throw new VstackError("GATE_REQUIRED", `task ${task.id} completes with no gate linked; declare a gateId`);
      }
      if (linkedGate) checkGateId(delivery, linkedGate);
      task.status = "done";
      task.evidenceId = evidenceId;
      task.artifact = maybeStr(args, "artifact") ?? task.artifact;
      task.updatedAt = ts;
      delivery.updatedAt = ts;
      return {
        result: { ok: true, task, evidence },
        event: { type: "task.completed", data: { id: task.id, evidenceId } },
      };
    });
  }

  async evidence(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.runTransaction((state) => {
      const delivery = active(state);
      const result = str(args, "result") as EvidenceResult;
      if (!RESULTS.includes(result)) {
        throw new VstackError("INVALID_ARGUMENT", "result must be passed, failed, blocked, not_verified or judgement");
      }
      const taskId = maybeStr(args, "taskId");
      if (taskId) findTask(delivery, taskId);
      const gateIdRaw = maybeStr(args, "gateId");
      const gateId = gateIdRaw ? checkGateId(delivery, gateIdRaw) : null;
      const artifact = maybeStr(args, "artifact");
      const item: Evidence = {
        id: `ev_${nextNumber(delivery.evidence.map((e) => e.id), "ev_")}`,
        claim: str(args, "claim"),
        check: str(args, "check"),
        result,
        artifact,
        gateId,
        digest: digestFor(this.store.root, artifact),
        taskId,
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
    return this.runTransaction((state) => {
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
    return this.runTransaction((state) => {
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
    return this.runTransaction((state) => {
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
      const reviewRaw = args.review;
      let review: { outcome: "approved" | "changes_requested"; notes: string; owner: string } | null = null;
      let diffRange: string | null = null;
      let reviewerEvidenceId: string | null = null;
      if (reviewRaw !== undefined) {
        const value = reviewRaw as Record<string, unknown>;
        const outcome = typeof value.outcome === "string" ? value.outcome : "";
        if (outcome !== "approved" && outcome !== "changes_requested") {
          throw new VstackError("INVALID_ARGUMENT", "review outcome must be approved or changes_requested");
        }
        const notes = typeof value.notes === "string" ? value.notes.trim() : "";
        const owner = typeof value.owner === "string" ? value.owner.trim() : "";
        if (!owner) throw new VstackError("REVIEW_INCOMPLETE", "a review needs a named owner");
        if (outcome === "changes_requested") {
          throw new VstackError("REVIEW_BLOCKING", `review requests changes: ${notes || "no notes"}`);
        }
        diffRange = typeof value.diffRange === "string" ? value.diffRange.trim() : "";
        reviewerEvidenceId = typeof value.reviewerEvidenceId === "string" ? value.reviewerEvidenceId.trim() : "";
        if (!diffRange) throw new VstackError("REVIEW_INCOMPLETE", "a review close needs a diffRange");
        if (!reviewerEvidenceId) throw new VstackError("REVIEW_INCOMPLETE", "a review close needs a reviewerEvidenceId");
        if (!delivery.evidence.some((item) => item.id === reviewerEvidenceId)) {
          throw new VstackError("REVIEW_INCOMPLETE", `reviewer evidence ${reviewerEvidenceId} does not exist`);
        }
        review = { outcome, notes, owner };
      }
      const reviewGateIds = new Set(delivery.gates.filter((g) => g.kind === "review").map((g) => g.id));
      const hasReviewEvidence = delivery.evidence.some((item) => item.gateId && reviewGateIds.has(item.gateId));
      if (hasReviewEvidence && !review) {
        throw new VstackError("REVIEW_INCOMPLETE", "delivery has review evidence; close needs a review with diffRange and reviewerEvidenceId");
      }
      const open = delivery.tasks.filter((task) => task.status !== "done");
      if (open.length > 0) {
        throw new VstackError("OPEN_TASKS", `open tasks: ${open.map((task) => task.id).join(", ")}`);
      }
      for (const task of delivery.tasks.filter((task) => task.status === "done")) {
        if (!task.evidenceId) throw new VstackError("EVIDENCE_REQUIRED", `task ${task.id} has no evidence`);
        if (!delivery.evidence.some((item) => item.id === task.evidenceId)) {
          throw new VstackError("EVIDENCE_REQUIRED", `task ${task.id} references missing evidence`);
        }
      }
      const failed = delivery.evidence.filter(
        (item) =>
          item.result === "failed" &&
          Boolean(item.taskId) &&
          delivery.tasks.some((task) => task.id === item.taskId)
      );
      if (failed.length > 0) {
        throw new VstackError("FAILED_EVIDENCE", `failed required checks: ${failed.map((item) => item.id).join(", ")}`);
      }
      for (const item of delivery.evidence) {
        if (item.artifact) {
          const current = digestFor(this.store.root, item.artifact);
          if (current !== item.digest) {
            throw new VstackError("DIGEST_MISMATCH", `artifact ${item.artifact} changed since evidence ${item.id} was recorded`);
          }
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
        review,
        diffRange,
        reviewerEvidenceId,
        waiver,
        closedAt,
      };
      this.store.writeDelivery(delivery, recordMarkdown(delivery, summary));
      return {
        result: { ok: true, delivery },
        event: { type: "delivery.closed", data: { record: delivery.close.recordPath, waived: Boolean(waiver) } },
      };
    });
  }
}
