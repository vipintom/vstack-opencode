import { Ajv } from "ajv";

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

export const STATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "revision", "createdAt", "updatedAt", "delivery"],
  properties: {
    schemaVersion: { const: 1 },
    revision: { type: "integer", minimum: 0 },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    delivery: {
      anyOf: [{ type: "null" }, { $ref: "#/$defs/delivery" }],
    },
  },
  $defs: {
    delivery: {
      type: "object",
      additionalProperties: false,
      required: [
        "id",
        "title",
        "tier",
        "playbook",
        "phase",
        "status",
        "outcome",
        "doneWhen",
        "skills",
        "skipped",
        "tasks",
        "evidence",
        "decisions",
        "handoffs",
        "createdAt",
        "updatedAt",
        "closedAt",
      ],
      properties: {
        id: { type: "string", pattern: "^dlv_[a-zA-Z0-9_-]+$" },
        title: { type: "string", minLength: 1 },
        tier: { enum: ["quick", "standard", "deep"] },
        playbook: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        phase: { enum: ["route", "shape", "plan", "build", "prove", "review", "close"] },
        status: { enum: ["active", "parked", "closed"] },
        outcome: { type: "string", minLength: 1 },
        doneWhen: { type: "string", minLength: 1 },
        skills: { type: "array", items: { type: "string" } },
        skipped: { type: "array", items: { type: "string" } },
        tasks: { type: "array", items: { $ref: "#/$defs/task" } },
        evidence: { type: "array", items: { $ref: "#/$defs/evidence" } },
        decisions: { type: "array", items: { $ref: "#/$defs/decision" } },
        handoffs: { type: "array", items: { $ref: "#/$defs/handoff" } },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
        closedAt: nullableString,
        close: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["recordPath", "summary", "waiver", "closedAt"],
              properties: {
                recordPath: { type: "string" },
                summary: { type: "string" },
                waiver: {
                  anyOf: [
                    { type: "null" },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["reason", "owner"],
                      properties: {
                        reason: { type: "string", minLength: 1 },
                        owner: { type: "string", minLength: 1 },
                      },
                    },
                  ],
                },
                closedAt: { type: "string" },
              },
            },
          ],
        },
      },
    },
    task: {
      type: "object",
      additionalProperties: false,
      required: ["id", "title", "status", "check", "evidenceId", "artifact", "createdAt", "updatedAt"],
      properties: {
        id: { type: "string", pattern: "^tsk_[a-zA-Z0-9_-]+$" },
        title: { type: "string", minLength: 1 },
        status: { enum: ["todo", "doing", "done", "blocked"] },
        check: { type: "string", minLength: 1 },
        evidenceId: nullableString,
        artifact: nullableString,
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
      },
    },
    evidence: {
      type: "object",
      additionalProperties: false,
      required: ["id", "claim", "check", "result", "artifact", "createdAt"],
      properties: {
        id: { type: "string", pattern: "^ev_[a-zA-Z0-9_-]+$" },
        claim: { type: "string", minLength: 1 },
        check: { type: "string", minLength: 1 },
        result: { enum: ["passed", "failed", "blocked", "not_verified", "judgement"] },
        artifact: nullableString,
        createdAt: { type: "string" },
      },
    },
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["id", "choice", "alternatives", "reason", "consequence", "owner", "createdAt"],
      properties: {
        id: { type: "string", pattern: "^dec_[a-zA-Z0-9_-]+$" },
        choice: { type: "string", minLength: 1 },
        alternatives: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 },
        consequence: { type: "string", minLength: 1 },
        owner: { type: "string", minLength: 1 },
        createdAt: { type: "string" },
      },
    },
    handoff: {
      type: "object",
      additionalProperties: false,
      required: ["id", "state", "nextAction", "blockers", "treeStatus", "createdAt"],
      properties: {
        id: { type: "string", pattern: "^hnd_[a-zA-Z0-9_-]+$" },
        state: { type: "string", minLength: 1 },
        nextAction: { type: "string", minLength: 1 },
        blockers: { type: "array", items: { type: "string" } },
        treeStatus: { type: "string" },
        createdAt: { type: "string" },
      },
    },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(STATE_SCHEMA);

export function validateState(value: unknown): { valid: boolean; errors: string[] } {
  const valid = Boolean(validate(value));
  return {
    valid,
    errors: valid
      ? []
      : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`),
  };
}

export function integrityErrors(state: {
  delivery: {
    tasks: Array<{ id: string; evidenceId: string | null }>;
    evidence: Array<{ id: string }>;
  } | null;
}): string[] {
  const delivery = state.delivery;
  if (!delivery) return [];
  const ids = new Set(delivery.evidence.map((e) => e.id));
  return delivery.tasks
    .filter((t) => t.evidenceId && !ids.has(t.evidenceId))
    .map((t) => `task ${t.id} references missing evidence ${t.evidenceId}`);
}
