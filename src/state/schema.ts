import type { State } from "./types.js";

type Errors = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function hasOnly(object: Record<string, unknown>, allowed: string[], path: string, errors: Errors): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) errors.push(`${path}/${key} unknown field`);
  }
}

function requireFields(object: Record<string, unknown>, fields: string[], path: string, errors: Errors): void {
  for (const field of fields) {
    if (!(field in object)) errors.push(`${path}/${field} required`);
  }
}

function stringField(object: Record<string, unknown>, field: string, path: string, errors: Errors, pattern?: RegExp): void {
  const value = object[field];
  if (!isString(value) || value.length === 0) {
    errors.push(`${path}/${field} must be a non-empty string`);
    return;
  }
  if (pattern && !pattern.test(value)) errors.push(`${path}/${field} has an invalid format`);
}

function nullableString(object: Record<string, unknown>, field: string, path: string, errors: Errors): void {
  const value = object[field];
  if (value !== null && !isString(value)) errors.push(`${path}/${field} must be a string or null`);
}

const ID = /^[a-zA-Z_]+[a-zA-Z0-9_-]*$/;

function delivery(value: unknown, path: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const fields = [
    "id", "title", "tier", "playbook", "phase", "status", "outcome", "doneWhen",
    "skills", "skipped", "tasks", "evidence", "decisions", "handoffs",
    "createdAt", "updatedAt", "closedAt",
  ];
  requireFields(value, fields, path, errors);
  hasOnly(value, [...fields, "close"], path, errors);
  stringField(value, "id", path, errors, ID);
  stringField(value, "title", path, errors);
  stringField(value, "tier", path, errors);
  stringField(value, "playbook", path, errors);
  stringField(value, "phase", path, errors);
  stringField(value, "status", path, errors);
  stringField(value, "outcome", path, errors);
  stringField(value, "doneWhen", path, errors);
  stringField(value, "createdAt", path, errors);
  stringField(value, "updatedAt", path, errors);
  if (!["quick", "standard", "deep"].includes(String(value.tier))) {
    errors.push(`${path}/tier must be quick, standard or deep`);
  }
  if (!["route", "shape", "plan", "build", "prove", "review", "close"].includes(String(value.phase))) {
    errors.push(`${path}/phase is unknown`);
  }
  if (!["active", "parked", "closed"].includes(String(value.status))) {
    errors.push(`${path}/status is unknown`);
  }
  nullableString(value, "closedAt", path, errors);

  for (const field of ["skills", "skipped"]) {
    const list = value[field];
    if (!Array.isArray(list) || list.some((item) => !isString(item))) {
      errors.push(`${path}/${field} must be an array of strings`);
    }
  }
  for (const field of ["tasks", "evidence", "decisions", "handoffs"]) {
    if (!Array.isArray(value[field])) errors.push(`${path}/${field} must be an array`);
  }
  if (Array.isArray(value.tasks)) value.tasks.forEach((item, index) => task(item, `${path}/tasks/${index}`, errors));
  if (Array.isArray(value.evidence)) value.evidence.forEach((item, index) => evidence(item, `${path}/evidence/${index}`, errors));
  if (Array.isArray(value.decisions)) value.decisions.forEach((item, index) => decision(item, `${path}/decisions/${index}`, errors));
  if (Array.isArray(value.handoffs)) value.handoffs.forEach((item, index) => handoff(item, `${path}/handoffs/${index}`, errors));

  if ("close" in value && value.close !== null && value.close !== undefined) {
    closeRecord(value.close, `${path}/close`, errors);
  }
}

function task(value: unknown, path: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const fields = ["id", "title", "status", "check", "evidenceId", "artifact", "createdAt", "updatedAt"];
  requireFields(value, fields, path, errors);
  hasOnly(value, fields, path, errors);
  stringField(value, "id", path, errors, ID);
  stringField(value, "title", path, errors);
  stringField(value, "check", path, errors);
  stringField(value, "createdAt", path, errors);
  stringField(value, "updatedAt", path, errors);
  if (!["todo", "doing", "done", "blocked"].includes(String(value.status))) {
    errors.push(`${path}/status is unknown`);
  }
  nullableString(value, "evidenceId", path, errors);
  nullableString(value, "artifact", path, errors);
}

function evidence(value: unknown, path: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const fields = ["id", "claim", "check", "result", "artifact", "createdAt"];
  requireFields(value, fields, path, errors);
  hasOnly(value, [...fields, "taskId"], path, errors);
  stringField(value, "id", path, errors, ID);
  stringField(value, "claim", path, errors);
  stringField(value, "check", path, errors);
  stringField(value, "createdAt", path, errors);
  if (!["passed", "failed", "blocked", "not_verified", "judgement"].includes(String(value.result))) {
    errors.push(`${path}/result is unknown`);
  }
  nullableString(value, "artifact", path, errors);
  if ("taskId" in value) nullableString(value, "taskId", path, errors);
}

function review(value: unknown, path: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const fields = ["outcome", "notes", "owner"];
  requireFields(value, fields, path, errors);
  hasOnly(value, fields, path, errors);
  if (!["approved", "changes_requested"].includes(String(value.outcome))) {
    errors.push(`${path}/outcome is unknown`);
  }
  if (!isString(value.notes)) errors.push(`${path}/notes must be a string`);
  stringField(value, "owner", path, errors);
}

function decision(value: unknown, path: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const fields = ["id", "choice", "alternatives", "reason", "consequence", "owner", "createdAt"];
  requireFields(value, fields, path, errors);
  hasOnly(value, fields, path, errors);
  for (const field of fields) stringField(value, field, path, errors);
}

function handoff(value: unknown, path: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  const fields = ["id", "state", "nextAction", "blockers", "treeStatus", "createdAt"];
  requireFields(value, fields, path, errors);
  hasOnly(value, fields, path, errors);
  stringField(value, "id", path, errors, ID);
  stringField(value, "state", path, errors);
  stringField(value, "nextAction", path, errors);
  stringField(value, "createdAt", path, errors);
  const blockers = value.blockers;
  if (!Array.isArray(blockers) || blockers.some((item) => !isString(item))) {
    errors.push(`${path}/blockers must be an array of strings`);
  }
  stringField(value, "treeStatus", path, errors);
}

function closeRecord(value: unknown, path: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object or null`);
    return;
  }
  const fields = ["recordPath", "summary", "waiver", "closedAt"];
  requireFields(value, fields, path, errors);
  hasOnly(value, [...fields, "review"], path, errors);
  stringField(value, "recordPath", path, errors);
  stringField(value, "closedAt", path, errors);
  if (!isString(value.summary)) errors.push(`${path}/summary must be a string`);
  if ("review" in value && value.review !== null && value.review !== undefined) {
    review(value.review, `${path}/review`, errors);
  }
  if (value.waiver !== null) {
    if (!isRecord(value.waiver)) {
      errors.push(`${path}/waiver must be an object or null`);
    } else {
      requireFields(value.waiver, ["reason", "owner"], `${path}/waiver`, errors);
      hasOnly(value.waiver, ["reason", "owner"], `${path}/waiver`, errors);
      stringField(value.waiver, "reason", `${path}/waiver`, errors);
      stringField(value.waiver, "owner", `${path}/waiver`, errors);
    }
  }
}

export function validateDelivery(value: unknown): { valid: boolean; errors: string[] } {
  const errors: Errors = [];
  delivery(value, "/delivery", errors);
  return { valid: errors.length === 0, errors };
}

export function validateState(value: unknown): { valid: boolean; errors: string[] } {
  const errors: Errors = [];
  if (!isRecord(value)) return { valid: false, errors: ["/ must be an object"] };
  const fields = ["schemaVersion", "revision", "createdAt", "updatedAt", "delivery"];
  requireFields(value, fields, "/", errors);
  hasOnly(value, fields, "/", errors);
  if (value.schemaVersion !== 1) errors.push("/schemaVersion must be 1");
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) {
    errors.push("/revision must be a non-negative integer");
  }
  stringField(value, "createdAt", "/", errors);
  stringField(value, "updatedAt", "/", errors);
  if (value.delivery !== null) delivery(value.delivery, "/delivery", errors);
  return { valid: errors.length === 0, errors };
}

export function integrityErrors(state: Pick<State, "delivery">): string[] {
  const delivery = state.delivery;
  if (!delivery) return [];
  const ids = new Set(delivery.evidence.map((item) => item.id));
  return delivery.tasks
    .filter((item) => item.evidenceId && !ids.has(item.evidenceId))
    .map((item) => `task ${item.id} references missing evidence ${item.evidenceId}`);
}
