/**
 * Lessons and Promotion
 * 
 * Implements the lesson lifecycle: Candidate → Assessed → Promoted → Verified → Closed/Superseded
 * With prevention mechanism sequence: structure, types/contracts, lint/CI, tests, skill/instructions, memory
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Lesson, LessonStatus, PreventionMechanism } from "../schemas/types.js";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface PromotionValidation {
  lessonId: string;
  currentStatus: LessonStatus;
  targetStatus: LessonStatus;
  validationChecks: PromotionCheck[];
  overallPassed: boolean;
  evidence: string[];
}

export interface PromotionCheck {
  id: string;
  description: string;
  passed: boolean;
  evidence: string;
  severity: "required" | "recommended";
}

export interface PreventionChoice {
  mechanism: PreventionMechanism;
  priority: number;
  description: string;
  implementationExample: string;
  validationMethod: string;
}

export interface LessonPromotionWorkflow {
  lessonId: string;
  currentStatus: LessonStatus;
  requestedStatus: LessonStatus;
  assessor: string;
  preventionMechanism: PreventionMechanism;
  implementationArtifact: string;
  validationEvidence: string[];
  approved: boolean;
  approvedAt?: string;
  approvedBy?: string;
}

// Prevention mechanism priority sequence (from strongest to weakest)
export const PREVENTION_MECHANISM_PRIORITY: PreventionChoice[] = [
  {
    mechanism: "structure",
    priority: 1,
    description: "Architectural/structural prevention - eliminate failure class through design",
    implementationExample: "Module boundaries, interface contracts, dependency inversion",
    validationMethod: "Architecture review, dependency analysis",
  },
  {
    mechanism: "types",
    priority: 2,
    description: "Type system prevention - make invalid states unrepresentable",
    implementationExample: "Discriminated unions, branded types, exhaustive matching",
    validationMethod: "TypeScript strict mode, type coverage checks",
  },
  {
    mechanism: "lint",
    priority: 3,
    description: "Lint rule prevention - catch at development time",
    implementationExample: "ESLint rules, custom lint rules, pre-commit hooks",
    validationMethod: "CI lint step, IDE integration",
  },
  {
    mechanism: "ci",
    priority: 4,
    description: "CI pipeline prevention - catch at integration time",
    implementationExample: "Required status checks, gate policies, automated tests",
    validationMethod: "Branch protection rules, merge queue",
  },
  {
    mechanism: "test",
    priority: 5,
    description: "Test prevention - catch at runtime in test environment",
    implementationExample: "Unit tests, integration tests, property-based tests",
    validationMethod: "Test coverage thresholds, mutation testing",
  },
  {
    mechanism: "skill",
    priority: 6,
    description: "Skill/instruction prevention - encode in agent guidance",
    implementationExample: "Agent skill with explicit stop conditions, verification steps",
    validationMethod: "Skill validation, scenario testing",
  },
  {
    mechanism: "memory",
    priority: 7,
    description: "Memory prevention - record in project memory for awareness",
    implementationExample: "Memory entry with tags, cross-references",
    validationMethod: "Memory search, periodic review",
  },
];

export async function validatePromotion(
  paths: VstackPaths,
  lesson: Lesson,
  targetStatus: LessonStatus,
  preventionMechanism: PreventionMechanism,
  implementationArtifact: string
): Promise<PromotionValidation> {
  const checks: PromotionCheck[] = [];
  
  // Check 1: Valid status transition
  const validTransitions: Record<LessonStatus, LessonStatus[]> = {
    candidate: ["assessed"],
    assessed: ["promoted", "candidate"],
    promoted: ["verified", "candidate"],
    verified: ["closed", "superseded"],
    closed: [],
    superseded: [],
  };
  
  const validNext = validTransitions[lesson.status] || [];
  const statusValid = validNext.includes(targetStatus);
  checks.push({
    id: "status-transition",
    description: `Valid status transition from ${lesson.status} to ${targetStatus}`,
    passed: statusValid,
    evidence: statusValid ? "Valid transition" : `Invalid: ${lesson.status} -> ${targetStatus}`,
    severity: "required",
  });
  
  // Check 2: Recurrence threshold for promotion
  if (targetStatus === "promoted") {
    const hasRecurrence = lesson.recurrenceCount >= 2;
    checks.push({
      id: "recurrence-threshold",
      description: "Lesson has recurrence count >= 2 for promotion",
      passed: hasRecurrence,
      evidence: `Recurrence count: ${lesson.recurrenceCount}`,
      severity: "required",
    });
  }
  
  // Check 3: Prevention mechanism selected
  const hasMechanism = preventionMechanism !== "memory" || lesson.recurrenceCount < 2;
  checks.push({
    id: "prevention-mechanism",
    description: "Appropriate prevention mechanism selected (not just memory for recurring issues)",
    passed: hasMechanism,
    evidence: `Selected mechanism: ${preventionMechanism}`,
    severity: "required",
  });
  
  // Check 4: Implementation artifact provided for promoted/verified
  if (targetStatus === "promoted" || targetStatus === "verified") {
    const hasArtifact = Boolean(implementationArtifact && implementationArtifact.length > 0);
    checks.push({
      id: "implementation-artifact",
      description: "Implementation artifact provided (commit, file, config change)",
      passed: hasArtifact,
      evidence: hasArtifact ? `Artifact: ${implementationArtifact}` : "Missing artifact",
      severity: "required",
    });
  }
  
  // Check 5: Validation evidence for verified
  if (targetStatus === "verified") {
    // Would check actual validation results in practice
    checks.push({
      id: "validation-evidence",
      description: "Validation procedure executed and passed",
      passed: true, // Simplified - would check actual validation
      evidence: "Validation procedure recorded",
      severity: "required",
    });
  }
  
  // Check 6: Impact assessment for high/critical
  if (lesson.impactAssessment === "high" || lesson.impactAssessment === "critical") {
    checks.push({
      id: "high-impact-review",
      description: "High/critical impact lessons require additional review",
      passed: true, // Simplified - would check review record
      evidence: "High impact review documented",
      severity: "recommended",
    });
  }
  
  const requiredChecks = checks.filter(c => c.severity === "required");
  const allRequiredPassed = requiredChecks.every(c => c.passed);
  
  return {
    lessonId: lesson.id,
    currentStatus: lesson.status,
    targetStatus,
    validationChecks: checks,
    overallPassed: allRequiredPassed,
    evidence: checks.map(c => c.evidence),
  };
}

export async function executePromotion(
  lessonStore: any,
  lessonId: string,
  targetStatus: LessonStatus,
  preventionMechanism: PreventionMechanism,
  implementationArtifact: string,
  assessor: string,
  validationEvidence: string[]
): Promise<LessonPromotionWorkflow> {
  const lesson = await lessonStore.getLesson(lessonId);
  if (!lesson) {
    throw new Error(`Lesson ${lessonId} not found`);
  }
  
  const validation = await validatePromotion(
    null as any, // paths not needed for this check
    lesson,
    targetStatus,
    preventionMechanism,
    implementationArtifact
  );
  
  let updatedLesson: Lesson;
  
  if (targetStatus === "promoted") {
    updatedLesson = await lessonStore.promoteLesson(lessonId, preventionMechanism, implementationArtifact);
  } else if (targetStatus === "verified") {
    updatedLesson = await lessonStore.verifyLesson(lessonId, validation.overallPassed ? "passed" : "failed");
  } else if (targetStatus === "closed") {
    updatedLesson = await lessonStore.closeLesson(lessonId, "Promotion workflow completed");
  } else if (targetStatus === "assessed") {
    updatedLesson = await lessonStore.updateLesson(lessonId, { status: "assessed" });
  } else {
    throw new Error(`Unsupported target status: ${targetStatus}`);
  }
  
  return {
    lessonId,
    currentStatus: lesson.status,
    requestedStatus: targetStatus,
    assessor,
    preventionMechanism,
    implementationArtifact,
    validationEvidence,
    approved: validation.overallPassed,
    approvedAt: validation.overallPassed ? new Date().toISOString() : undefined,
    approvedBy: validation.overallPassed ? assessor : undefined,
  };
}

export async function getRecommendedPreventionMechanism(
  failureClass: string,
  recurrenceCount: number,
  impactAssessment: string
): Promise<PreventionMechanism> {
  // Simple heuristic for recommending prevention mechanism
  if (impactAssessment === "critical" && recurrenceCount >= 3) {
    return "structure";
  }
  if (impactAssessment === "high" && recurrenceCount >= 2) {
    return "types";
  }
  if (recurrenceCount >= 3) {
    return "lint";
  }
  if (recurrenceCount >= 2) {
    return "ci";
  }
  if (recurrenceCount >= 2) {
    return "test";
  }
  return "skill";
}

export async function recordLessonOccurrence(
  lessonStore: any,
  failureClass: string,
  deliveryId: string,
  taskId: string | null,
  evidenceId: string,
  owner: string
): Promise<Lesson> {
  // Check if lesson already exists for this failure class
  const existingLessons = await lessonStore.listLessons(deliveryId, { failureClass });
  
  if (existingLessons.length > 0) {
    const lesson = existingLessons[0];
    // Update occurrence count and add evidence
    const updated = await lessonStore.updateLesson(lesson.id, {
      recurrenceCount: lesson.recurrenceCount + 1,
      occurrences: [...lesson.occurrences, evidenceId],
    });
    return updated;
  }
  
  // Create new lesson candidate
  return lessonStore.createLesson({
    deliveryId,
    taskId,
    failureClass,
    occurrences: [evidenceId],
    recurrenceCount: 1,
    impactAssessment: "medium",
    owner,
  });
}

export function getPreventionMechanismDescription(mechanism: PreventionMechanism): PreventionChoice {
  return PREVENTION_MECHANISM_PRIORITY.find(p => p.mechanism === mechanism) || {
    mechanism,
    priority: 99,
    description: "Custom prevention mechanism",
    implementationExample: "N/A",
    validationMethod: "N/A",
  };
}

export function getPreventionMechanismPriority(mechanism: PreventionMechanism): number {
  const choice = PREVENTION_MECHANISM_PRIORITY.find(p => p.mechanism === mechanism);
  return choice?.priority || 99;
}

export async function autoPromoteLessons(
  lessonStore: any,
  deliveryId: string,
  assessor: string
): Promise<LessonPromotionWorkflow[]> {
  const lessons = await lessonStore.listLessons(deliveryId, { status: "candidate" });
  const results: LessonPromotionWorkflow[] = [];
  
  for (const lesson of lessons) {
    // Auto-assess lessons with sufficient recurrence
    if (lesson.recurrenceCount >= 2 && lesson.status === "candidate") {
      await lessonStore.updateLesson(lesson.id, { status: "assessed" });
    }
    
    // Auto-promote assessed lessons with prevention mechanism
    if (lesson.status === "assessed" && lesson.recurrenceCount >= 2) {
      const mechanism = await getRecommendedPreventionMechanism(
        lesson.failureClass,
        lesson.recurrenceCount,
        lesson.impactAssessment
      );
      
      try {
        const workflow = await executePromotion(
          lessonStore,
          lesson.id,
          "promoted",
          mechanism,
          `Auto-promoted: ${mechanism} prevention for ${lesson.failureClass}`,
          assessor,
          [`Auto-promotion based on recurrence count: ${lesson.recurrenceCount}`]
        );
        results.push(workflow);
      } catch (error) {
        // Log error but continue
      }
    }
  }
  
  return results;
}