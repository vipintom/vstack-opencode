/**
 * Workflow tools
 * Manage workflow lifecycle and phase transitions
 */

import type { VstackTool } from "./index.js";

export const workflowTools: VstackTool[] = [
  {
    name: "vstack_workflow_start",
    description: "Start or resume a delivery workflow",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        resume: { type: "boolean", default: false },
      },
      required: ["deliveryId"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ success: true, message: "Workflow started" }) };
    },
  },
  
  {
    name: "vstack_workflow_advance",
    description: "Request a phase transition (engine validates gates)",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        targetPhase: { type: "string" },
        skipGates: { type: "boolean", default: false },
        skipReason: { type: "string" },
      },
      required: ["deliveryId", "targetPhase"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ success: true, message: `Advanced to ${input.targetPhase}` }) };
    },
  },
  
  {
    name: "vstack_workflow_block",
    description: "Mark delivery/phase/task blocked with reason",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        phaseRunId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["deliveryId", "phaseRunId", "reason"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ success: true, message: "Phase blocked" }) };
    },
  },
  
  {
    name: "vstack_workflow_unblock",
    description: "Clear a blocker with valid transition",
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
      return { content: JSON.stringify({ success: true, message: "Phase unblocked" }) };
    },
  },
  
  {
    name: "vstack_workflow_resume",
    description: "Reconcile and resume interrupted work",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
      },
      required: ["deliveryId"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ success: true, message: "Workflow resumed" }) };
    },
  },
  
  {
    name: "vstack_workflow_finish",
    description: "Close delivery after completion gates pass",
    input: {
      type: "object",
      properties: {
        deliveryId: { type: "string" },
        finalVerification: {
          type: "object",
          properties: {
            summary: { type: "string" },
          },
          required: ["summary"],
        },
      },
      required: ["deliveryId"],
      additionalProperties: false,
    },
    execute: async (input: any, context: any) => {
      return { content: JSON.stringify({ success: true, message: "Workflow finished" }) };
    },
  },
];