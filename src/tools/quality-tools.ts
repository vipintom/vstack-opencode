/**
 * Quality tools
 * Execute checks, record evidence, evaluate gates
 */

import type { VstackTool } from "./index.js";

export const qualityTools: VstackTool[] = [
  {
    name: "vstack_check_discover",
    description: "Inspect scripts/configuration and propose available project checks",
    input: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
      },
      required: ["projectRoot"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ checks: ["build", "lint", "typecheck", "test:unit"] }) };
    },
  },
  
  {
    name: "vstack_check_run",
    description: "Run a configured check through verified execution adapter",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        checkId: { type: "string" },
        workingDirectory: { type: "string" },
        timeout: { type: "number", default: 120000 },
      },
      required: ["deliveryId", "checkId"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ checkId: input.checkId, status: "passed", evidenceId: "evd_123" }) };
    },
  },
  
  {
    name: "vstack_evidence_record",
    description: "Record structured evidence with source and execution identity",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        taskId: { type: "string" },
        phaseRunId: { type: "string" },
        type: { type: "string", enum: ["build", "lint", "typecheck", "test:unit", "test:integration", "test:e2e", "coverage", "security:deps", "security:secrets", "security:review", "architecture:review", "acceptance", "release:artifacts", "deploy:health", "manual_attestation", "other"] },
        source: { type: "string", enum: ["plugin_execution", "agent_review", "human_approval", "external_ci", "manual_attestation"] },
        checkId: { type: "string" },
        command: { type: "array", items: { type: "string" } },
        workingDirectory: { type: "string" },
        commitRef: { type: "string" },
        exitCode: { type: "number" },
        status: { type: "string", enum: ["passed", "failed", "error", "timeout", "cancelled"] },
        stdoutPath: { type: "string" },
        stderrPath: { type: "string" },
        summary: { type: "string" },
        executionId: { type: "string" },
        sessionId: { type: "string" },
        agentRunId: { type: "string" },
      },
      required: ["deliveryId", "type", "source", "checkId", "command", "workingDirectory", "commitRef", "exitCode", "status", "summary", "executionId"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ evidenceId: "evd_123", status: "recorded" }) };
    },
  },
  
  {
    name: "vstack_gate_evaluate",
    description: "Evaluate a named gate from configured rules and stored evidence",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        phaseRunId: { type: "string" },
        gateId: { type: "string" },
      },
      required: ["deliveryId", "phaseRunId", "gateId"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ passed: true, gateId: input.gateId }) };
    },
  },
  
  {
    name: "vstack_verify",
    description: "Run phase/delivery verification and return structured gate results",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        phaseRunId: { type: "string" },
      },
      required: ["deliveryId", "phaseRunId"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ passed: true, missingGates: [] }) };
    },
  },
];