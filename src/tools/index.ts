import { VstackService } from "../service.js";
import { StateStore } from "../state/store.js";
import { VstackError } from "../state/types.js";

export interface VstackTool {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: unknown) => Promise<{ content: string }>;
}

function respond(value: unknown): { content: string } {
  return { content: JSON.stringify(value) };
}

function failure(error: unknown): { content: string } {
  if (error instanceof VstackError) {
    return respond({ ok: false, error: { code: error.code, message: error.message } });
  }
  return respond({ ok: false, error: { code: "INTERNAL", message: String(error) } });
}

function wrapper(name: string, description: string, input: Record<string, unknown>, run: (args: Record<string, unknown>, context: unknown) => Promise<Record<string, unknown>>): VstackTool {
  return {
    name,
    description,
    input,
    async execute(args, context) {
      try {
        return respond(await run(args ?? {}, context));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

export function createTools(store: StateStore): VstackTool[] {
  const service = new VstackService(store);

  return [
    wrapper(
      "vstack_route",
      "Open, park, resume or read a vstack delivery. No arguments reads state. Opening records the playbook, tier, outcome and done-when. Parking archives the delivery and frees the slot; resume restores it. A phase change may move forward; backward requires a reason.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { enum: ["open", "read", "park", "resume", "phase"] },
          id: { type: "string" },
          title: { type: "string" },
          tier: { enum: ["quick", "standard", "deep"] },
          playbook: { type: "string" },
          outcome: { type: "string" },
          doneWhen: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
          skipped: { type: "array", items: { type: "string" } },
          phase: { enum: ["route", "shape", "plan", "build", "prove", "review", "close"] },
          reason: { type: "string" },
        },
      },
      (args) => service.route(args)
    ),
    wrapper(
      "vstack_task",
      "Add, start or complete a task. Every task needs a check. Completion requires evidence whose result is passed or judgement; completion without evidence is refused.",
      {
        type: "object",
        additionalProperties: false,
        required: ["action"],
        properties: {
          action: { enum: ["add", "start", "complete"] },
          taskId: { type: "string" },
          title: { type: "string" },
          check: { type: "string" },
          evidenceId: { type: "string" },
          artifact: { type: "string" },
        },
      },
      (args) => service.task(args)
    ),
    wrapper(
      "vstack_evidence",
      "Record one claim with the check, result and artifact that support it. Results: passed, failed, blocked, not_verified or judgement.",
      {
        type: "object",
        additionalProperties: false,
        required: ["claim", "check", "result"],
        properties: {
          claim: { type: "string" },
          check: { type: "string" },
          result: { enum: ["passed", "failed", "blocked", "not_verified", "judgement"] },
          artifact: { type: "string" },
          taskId: { type: "string" },
        },
      },
      (args) => service.evidence(args)
    ),
    wrapper(
      "vstack_decision",
      "Record a choice with the alternatives considered, the reason, the consequence and the owner. A decision without an alternative or a reason is refused.",
      {
        type: "object",
        additionalProperties: false,
        required: ["choice", "alternatives", "reason", "consequence", "owner"],
        properties: {
          choice: { type: "string" },
          alternatives: { type: "string" },
          reason: { type: "string" },
          consequence: { type: "string" },
          owner: { type: "string" },
        },
      },
      (args) => service.decision(args)
    ),
    wrapper(
      "vstack_handoff",
      "Record the state, next action, blockers and tree status for the next session. A handoff without a next action is refused.",
      {
        type: "object",
        additionalProperties: false,
        required: ["state", "nextAction"],
        properties: {
          state: { type: "string" },
          nextAction: { type: "string" },
          blockers: { type: "array", items: { type: "string" } },
          treeStatus: { type: "string" },
        },
      },
      (args) => service.handoff(args)
    ),
    wrapper(
      "vstack_close",
      "Validate and close the delivery, then write a durable record under .vstack/deliveries/. Open tasks, missing evidence or failed required checks refuse the close; a waiver needs a reason and an owner; a review outcome is recorded.",
      {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "string" },
          review: {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "owner"],
            properties: {
              outcome: { enum: ["approved", "changes_requested"] },
              notes: { type: "string" },
              owner: { type: "string" },
            },
          },
          waiver: {
            type: "object",
            additionalProperties: false,
            required: ["reason", "owner"],
            properties: { reason: { type: "string" }, owner: { type: "string" } },
          },
        },
      },
      (args) => service.close(args)
    ),
  ];
}
