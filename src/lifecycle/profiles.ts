/**
 * Delivery lifecycle profiles
 * Define phase sequences, requirements, gates, and approval rules for different work types
 */

import { ProfileId, DeliveryPhase, PhaseRunStatus, EvidenceType } from "../schemas/types.js";

export interface PhaseRequirement {
  phase: DeliveryPhase;
  required: boolean;
  requiredGates: EvidenceType[];
  optionalGates: EvidenceType[];
  approvalRequired: boolean;
  approvalType?: "design" | "release" | "publish" | "production_deployment" | "destructive_migration" | "rollback" | "scope_change";
  skipAllowed: boolean;
  skipRequiresReason: boolean;
}

export interface LifecycleProfile {
  id: ProfileId;
  name: string;
  description: string;
  phases: PhaseRequirement[];
  defaultParallelism: number;
  maxReviewRuns: number;
}

export const LIFECYCLE_PROFILES: Record<ProfileId, LifecycleProfile> = {
  "bug-fix": {
    id: "bug-fix",
    name: "Bug Fix",
    description: "Minimal lifecycle for bug fixes - discovery, implementation, validation, review",
    defaultParallelism: 2,
    maxReviewRuns: 3,
    phases: [
      {
        phase: "intake",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "discovery",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "implementation",
        required: true,
        requiredGates: ["build", "lint", "typecheck", "test:unit"],
        optionalGates: ["test:integration", "test:e2e"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "validation",
        required: true,
        requiredGates: ["acceptance"],
        optionalGates: ["security:deps", "security:secrets"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "review",
        required: true,
        requiredGates: ["security:review"],
        optionalGates: ["architecture:review"],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "completed",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
    ],
  },
  
  "feature": {
    id: "feature",
    name: "Feature Delivery",
    description: "Full lifecycle for new features - discovery through post-release",
    defaultParallelism: 3,
    maxReviewRuns: 7,
    phases: [
      {
        phase: "intake",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "discovery",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "design",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "design",
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "planning",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "implementation",
        required: true,
        requiredGates: ["build", "lint", "typecheck", "test:unit"],
        optionalGates: ["test:integration", "test:e2e", "coverage"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "validation",
        required: true,
        requiredGates: ["acceptance", "security:deps", "security:secrets"],
        optionalGates: ["security:review"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "review",
        required: true,
        requiredGates: ["security:review"],
        optionalGates: ["architecture:review"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "release_preparation",
        required: true,
        requiredGates: ["release:artifacts"],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "release",
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "deployment",
        required: false,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "production_deployment",
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "post_release",
        required: false,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "completed",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
    ],
  },
  
  "refactor": {
    id: "refactor",
    name: "Refactoring",
    description: "Lifecycle for code refactoring - discovery, planning, implementation, validation, review",
    defaultParallelism: 2,
    maxReviewRuns: 3,
    phases: [
      {
        phase: "intake",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "discovery",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "planning",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "implementation",
        required: true,
        requiredGates: ["build", "lint", "typecheck", "test:unit", "test:integration"],
        optionalGates: ["test:e2e", "coverage"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "validation",
        required: true,
        requiredGates: ["acceptance", "security:deps"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "review",
        required: true,
        requiredGates: ["architecture:review"],
        optionalGates: ["security:review"],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "completed",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
    ],
  },
  
  "architecture-change": {
    id: "architecture-change",
    name: "Architecture Change",
    description: "Lifecycle for significant architecture changes with design review gate",
    defaultParallelism: 2,
    maxReviewRuns: 10,
    phases: [
      {
        phase: "intake",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "discovery",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "design",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "design",
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "planning",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "implementation",
        required: true,
        requiredGates: ["build", "lint", "typecheck", "test:unit", "test:integration"],
        optionalGates: ["test:e2e", "coverage", "security:deps", "security:secrets"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "validation",
        required: true,
        requiredGates: ["acceptance", "security:review"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "review",
        required: true,
        requiredGates: ["architecture:review", "security:review"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "release_preparation",
        required: true,
        requiredGates: ["release:artifacts"],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "release",
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "deployment",
        required: true,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "production_deployment",
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "post_release",
        required: true,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "completed",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
    ],
  },
  
  "infrastructure-change": {
    id: "infrastructure-change",
    name: "Infrastructure Change",
    description: "Lifecycle for infrastructure changes with deployment approval gates",
    defaultParallelism: 2,
    maxReviewRuns: 5,
    phases: [
      {
        phase: "intake",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "discovery",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "design",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "design",
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "planning",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "implementation",
        required: true,
        requiredGates: ["build", "lint", "typecheck"],
        optionalGates: ["test:integration", "security:deps"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "validation",
        required: true,
        requiredGates: ["acceptance", "security:review"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "review",
        required: true,
        requiredGates: ["architecture:review", "security:review"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "deployment",
        required: true,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "production_deployment",
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "post_release",
        required: true,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "completed",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
    ],
  },
  
  "documentation": {
    id: "documentation",
    name: "Documentation",
    description: "Lightweight lifecycle for documentation changes",
    defaultParallelism: 1,
    maxReviewRuns: 2,
    phases: [
      {
        phase: "intake",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "discovery",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "implementation",
        required: true,
        requiredGates: ["lint"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "review",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "completed",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
    ],
  },
  
  "release-only": {
    id: "release-only",
    name: "Release Only",
    description: "Lifecycle for releasing already-completed work",
    defaultParallelism: 1,
    maxReviewRuns: 2,
    phases: [
      {
        phase: "intake",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "release_preparation",
        required: true,
        requiredGates: ["release:artifacts"],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "release",
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "validation",
        required: true,
        requiredGates: ["test:unit", "test:integration", "security:deps", "security:secrets"],
        optionalGates: ["test:e2e", "coverage"],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
      {
        phase: "deployment",
        required: false,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: true,
        approvalType: "publish",
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "post_release",
        required: false,
        requiredGates: ["deploy:health"],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: true,
        skipRequiresReason: true,
      },
      {
        phase: "completed",
        required: true,
        requiredGates: [],
        optionalGates: [],
        approvalRequired: false,
        skipAllowed: false,
        skipRequiresReason: false,
      },
    ],
  },
};

/**
 * Get a lifecycle profile by ID
 */
export function getProfile(profileId: ProfileId): LifecycleProfile {
  const profile = LIFECYCLE_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown lifecycle profile: ${profileId}`);
  }
  return profile;
}

/**
 * Get all available profile IDs
 */
export function getAvailableProfiles(): ProfileId[] {
  return Object.keys(LIFECYCLE_PROFILES) as ProfileId[];
}

/**
 * Get the next phase in a profile
 */
export function getNextPhase(profileId: ProfileId, currentPhase: DeliveryPhase): DeliveryPhase | null {
  const profile = getProfile(profileId);
  const currentIndex = profile.phases.findIndex(p => p.phase === currentPhase);
  
  if (currentIndex === -1) return null;
  if (currentIndex === profile.phases.length - 1) return null;
  
  // Find next required phase
  for (let i = currentIndex + 1; i < profile.phases.length; i++) {
    const phase = profile.phases[i];
    if (phase && phase.required) {
      return phase.phase;
    }
  }
  
  // If no required phases left, return the last phase (completed)
  return "completed";
}

/**
 * Check if a phase can be skipped in a profile
 */
export function canSkipPhase(profileId: ProfileId, phase: DeliveryPhase): boolean {
  const profile = getProfile(profileId);
  const phaseReq = profile.phases.find(p => p.phase === phase);
  return phaseReq?.skipAllowed ?? false;
}

/**
 * Get required gates for a phase in a profile
 */
export function getRequiredGates(profileId: ProfileId, phase: DeliveryPhase): EvidenceType[] {
  const profile = getProfile(profileId);
  const phaseReq = profile.phases.find(p => p.phase === phase);
  return phaseReq?.requiredGates ?? [];
}

/**
 * Get optional gates for a phase in a profile
 */
export function getOptionalGates(profileId: ProfileId, phase: DeliveryPhase): EvidenceType[] {
  const profile = getProfile(profileId);
  const phaseReq = profile.phases.find(p => p.phase === phase);
  return phaseReq?.optionalGates ?? [];
}

/**
 * Check if approval is required for a phase in a profile
 */
export function isApprovalRequired(profileId: ProfileId, phase: DeliveryPhase): boolean {
  const profile = getProfile(profileId);
  const phaseReq = profile.phases.find(p => p.phase === phase);
  return phaseReq?.approvalRequired ?? false;
}

/**
 * Get approval type for a phase in a profile
 */
export function getApprovalType(profileId: ProfileId, phase: DeliveryPhase): PhaseRequirement["approvalType"] | undefined {
  const profile = getProfile(profileId);
  const phaseReq = profile.phases.find(p => p.phase === phase);
  return phaseReq?.approvalType;
}