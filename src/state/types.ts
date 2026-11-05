export type Tier = "quick" | "standard" | "deep";
export type Phase = "route" | "shape" | "plan" | "build" | "prove" | "review" | "close";
export type DeliveryStatus = "active" | "parked" | "closed";
export type TaskStatus = "todo" | "doing" | "done" | "blocked";
export type EvidenceResult = "passed" | "failed" | "blocked" | "not_verified" | "judgement";
export type ReviewOutcome = "approved" | "changes_requested";
export type GateKind = "command" | "artifact" | "review";

export interface Gate {
  id: string;
  kind: GateKind;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  check: string;
  evidenceId: string | null;
  artifact: string | null;
  gateId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Evidence {
  id: string;
  claim: string;
  check: string;
  result: EvidenceResult;
  artifact: string | null;
  gateId: string | null;
  digest: string | null;
  taskId?: string | null;
  createdAt: string;
}

export interface Review {
  outcome: ReviewOutcome;
  notes: string;
  owner: string;
}

export interface Decision {
  id: string;
  choice: string;
  alternatives: string;
  reason: string;
  consequence: string;
  owner: string;
  createdAt: string;
}

export interface Handoff {
  id: string;
  state: string;
  nextAction: string;
  blockers: string[];
  treeStatus: string;
  createdAt: string;
}

export interface CloseRecord {
  recordPath: string;
  summary: string;
  review?: Review | null;
  diffRange: string | null;
  reviewerEvidenceId: string | null;
  waiver: { reason: string; owner: string } | null;
  closedAt: string;
}

export interface Delivery {
  id: string;
  title: string;
  tier: Tier;
  playbook: string;
  phase: Phase;
  status: DeliveryStatus;
  outcome: string;
  doneWhen: string;
  skills: string[];
  gates: Gate[];
  skipped: string[];
  tasks: Task[];
  evidence: Evidence[];
  decisions: Decision[];
  handoffs: Handoff[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  close?: CloseRecord | null;
}

export interface State {
  schemaVersion: 2;
  revision: number;
  createdAt: string;
  updatedAt: string;
  delivery: Delivery | null;
}

export type HistoryEventType =
  | "delivery.opened"
  | "delivery.parked"
  | "delivery.resumed"
  | "phase.changed"
  | "task.added"
  | "task.imported"
  | "task.started"
  | "task.completed"
  | "evidence.recorded"
  | "decision.recorded"
  | "handoff.recorded"
  | "delivery.closed";

export interface HistoryEvent {
  ts: string;
  type: HistoryEventType;
  deliveryId: string;
  data: Record<string, unknown>;
  revision: number;
  seq: number;
  prevHash: string | null;
  hash: string;
}

export class VstackError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "VstackError";
  }
}
