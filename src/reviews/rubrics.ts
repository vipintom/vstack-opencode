/**
 * Review rubrics
 * Defines review criteria, lenses, and scoring guidelines
 */

export type ReviewLens = 
  | "correctness_regression"
  | "architecture_design"
  | "security_data"
  | "performance_resources"
  | "maintainability_style"
  | "test_adequacy"
  | "documentation_migration";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "informational";

export interface RubricCriterion {
  id: string;
  lens: ReviewLens;
  title: string;
  description: string;
  severityThresholds: {
    critical: string;
    high: string;
    medium: string;
    low: string;
    informational: string;
  };
  weight: number; // For scoring
}

export interface ReviewProfile {
  id: string;
  name: string;
  description: string;
  lenses: ReviewLens[];
  criteria: RubricCriterion[];
  passingThreshold: number; // minimum score to pass
  requiredLenses: ReviewLens[];
}

export interface ReviewScore {
  total: number;
  maxPossible: number;
  byLens: Record<ReviewLens, { score: number; max: number }>;
  passed: boolean;
}

/**
 * Default rubric criteria
 */
export const DEFAULT_RUBRIC_CRITERIA: RubricCriterion[] = [
  // Correctness & Regression
  {
    id: "cr-01",
    lens: "correctness_regression",
    title: "Functional Requirements Met",
    description: "Implementation satisfies all stated functional requirements",
    severityThresholds: {
      critical: "Core functionality broken or missing",
      high: "Major feature not working as specified",
      medium: "Minor feature deviation from requirements",
      low: "Edge case not handled per requirements",
      informational: "Requirement clarification needed",
    },
    weight: 3,
  },
  {
    id: "cr-02",
    lens: "correctness_regression",
    title: "No Functional Regressions",
    description: "Existing functionality continues to work as before",
    severityThresholds: {
      critical: "Previously working feature now broken",
      high: "Significant regression in core flow",
      medium: "Minor regression in edge case",
      low: "Cosmetic regression",
      informational: "Potential regression risk identified",
    },
    weight: 3,
  },
  {
    id: "cr-03",
    lens: "correctness_regression",
    title: "Edge Case Handling",
    description: "Error cases, boundary conditions, and invalid inputs handled correctly",
    severityThresholds: {
      critical: "Unhandled exception in critical path",
      high: "Error case causes incorrect behavior",
      medium: "Edge case not handled gracefully",
      low: "Missing validation for rare case",
      informational: "Additional validation could be added",
    },
    weight: 2,
  },
  
  // Architecture & Design
  {
    id: "ad-01",
    lens: "architecture_design",
    title: "Architectural Alignment",
    description: "Changes align with overall system architecture and patterns",
    severityThresholds: {
      critical: "Fundamental architectural violation",
      high: "Significant deviation from established patterns",
      medium: "Minor architectural inconsistency",
      low: "Pattern not followed in isolated case",
      informational: "Alternative pattern could be considered",
    },
    weight: 3,
  },
  {
    id: "ad-02",
    lens: "architecture_design",
    title: "Scalability & Extensibility",
    description: "Design supports future growth and changes",
    severityThresholds: {
      critical: "Design prevents scaling beyond current load",
      high: "Significant scaling bottleneck introduced",
      medium: "Limited extensibility for foreseeable changes",
      low: "Minor flexibility concern",
      informational: "Future extension point identified",
    },
    weight: 2,
  },
  {
    id: "ad-03",
    lens: "architecture_design",
    title: "Coupling & Cohesion",
    description: "Appropriate separation of concerns and module boundaries",
    severityThresholds: {
      critical: "Tight coupling between unrelated components",
      high: "Excessive cross-module dependencies",
      medium: "Module boundaries blurred",
      low: "Minor coupling concern",
      informational: "Refactoring opportunity identified",
    },
    weight: 2,
  },
  
  // Security & Data
  {
    id: "sd-01",
    lens: "security_data",
    title: "Authentication & Authorization",
    description: "Access controls properly implemented and enforced",
    severityThresholds: {
      critical: "Authentication bypass or privilege escalation",
      high: "Missing authorization check on sensitive operation",
      medium: "Inconsistent authorization pattern",
      low: "Minor permission granularity issue",
      informational: "Authorization could be more granular",
    },
    weight: 3,
  },
  {
    id: "sd-02",
    lens: "security_data",
    title: "Data Protection",
    description: "Sensitive data properly protected at rest and in transit",
    severityThresholds: {
      critical: "PII/secrets exposed in logs or error messages",
      high: "Sensitive data stored unencrypted",
      medium: "Insufficient encryption for sensitive field",
      low: "Missing data classification",
      informational: "Data retention policy not documented",
    },
    weight: 3,
  },
  {
    id: "sd-03",
    lens: "security_data",
    title: "Input Validation & Sanitization",
    description: "All external inputs properly validated and sanitized",
    severityThresholds: {
      critical: "SQL injection or XSS vulnerability",
      high: "Missing validation on user-controlled input",
      medium: "Insufficient sanitization for context",
      low: "Validation could be more strict",
      informational: "Additional validation layer recommended",
    },
    weight: 3,
  },
  
  // Performance & Resources
  {
    id: "pr-01",
    lens: "performance_resources",
    title: "Time Complexity",
    description: "Algorithms and queries have acceptable time complexity",
    severityThresholds: {
      critical: "O(n²) or worse in hot path",
      high: "Unnecessary O(n) where O(1) possible",
      medium: "Query missing index on large table",
      low: "Minor optimization opportunity",
      informational: "Could use more efficient algorithm",
    },
    weight: 2,
  },
  {
    id: "pr-02",
    lens: "performance_resources",
    title: "Memory & Resource Usage",
    description: "No memory leaks, excessive allocations, or resource exhaustion",
    severityThresholds: {
      critical: "Memory leak in long-running process",
      high: "Unbounded memory growth",
      medium: "Excessive object allocation in loop",
      low: "Minor allocation optimization",
      informational: "Could use object pooling",
    },
    weight: 2,
  },
  {
    id: "pr-03",
    lens: "performance_resources",
    title: "Concurrency & Parallelism",
    description: "Proper handling of concurrent access and race conditions",
    severityThresholds: {
      critical: "Race condition causing data corruption",
      high: "Deadlock or livelock possible",
      medium: "Unnecessary serialization",
      low: "Lock contention in hot path",
      informational: "Could use finer-grained locking",
    },
    weight: 2,
  },
  
  // Maintainability & Style
  {
    id: "ms-01",
    lens: "maintainability_style",
    title: "Code Clarity",
    description: "Code is readable, well-named, and self-documenting",
    severityThresholds: {
      critical: "Code is incomprehensible or misleading",
      high: "Critical logic obscured by complexity",
      medium: "Significant naming or structure issues",
      low: "Minor naming inconsistency",
      informational: "Could add clarifying comment",
    },
    weight: 2,
  },
  {
    id: "ms-02",
    lens: "maintainability_style",
    title: "Consistency",
    description: "Follows project conventions and patterns",
    severityThresholds: {
      critical: "Violates fundamental project convention",
      high: "Inconsistent with established patterns",
      medium: "Minor style deviation",
      low: "Formatting issue",
      informational: "Could follow convention more closely",
    },
    weight: 2,
  },
  {
    id: "ms-03",
    lens: "maintainability_style",
    title: "Documentation & Comments",
    description: "Complex logic documented; public APIs documented",
    severityThresholds: {
      critical: "Critical undocumented public API",
      high: "Complex algorithm without explanation",
      medium: "Missing docstring for public function",
      low: "Comment could be more descriptive",
      informational: "Could add usage example",
    },
    weight: 1,
  },
  
  // Test Adequacy
  {
    id: "ta-01",
    lens: "test_adequacy",
    title: "Test Coverage",
    description: "Adequate test coverage for new and changed code",
    severityThresholds: {
      critical: "No tests for critical functionality",
      high: "Critical path untested",
      medium: "Significant code paths untested",
      low: "Coverage below project threshold",
      informational: "Could add edge case tests",
    },
    weight: 3,
  },
  {
    id: "ta-02",
    lens: "test_adequacy",
    title: "Test Quality",
    description: "Tests are meaningful, deterministic, and maintainable",
    severityThresholds: {
      critical: "Tests pass but verify nothing meaningful",
      high: "Flaky tests or tests with external dependencies",
      medium: "Tests verify implementation details not behavior",
      low: "Test names not descriptive",
      informational: "Could add more descriptive assertions",
    },
    weight: 2,
  },
  {
    id: "ta-03",
    lens: "test_adequacy",
    title: "Regression Protection",
    description: "Tests protect against regressions in existing functionality",
    severityThresholds: {
      critical: "Regression not caught by tests",
      high: "No regression test for previously fixed bug",
      medium: "Insufficient integration test coverage",
      low: "Could add regression test for edge case",
      informational: "Could add contract test",
    },
    weight: 2,
  },
  
  // Documentation & Migration
  {
    id: "dm-01",
    lens: "documentation_migration",
    title: "Documentation Completeness",
    description: "All user-facing changes documented",
    severityThresholds: {
      critical: "Breaking change undocumented",
      high: "New feature undocumented",
      medium: "Configuration option undocumented",
      low: "Minor doc update missing",
      informational: "Could add example",
    },
    weight: 2,
  },
  {
    id: "dm-02",
    lens: "documentation_migration",
    title: "Migration Guide",
    description: "Breaking changes have clear migration path",
    severityThresholds: {
      critical: "Breaking change with no migration path",
      high: "Migration guide incomplete or incorrect",
      medium: "Migration steps unclear",
      low: "Migration example missing",
      informational: "Could add troubleshooting section",
    },
    weight: 3,
  },
];

/**
 * Review profiles
 */
export const REVIEW_PROFILES = {
  quick: {
    id: "quick",
    name: "Quick Review",
    description: "Fast review focusing on critical correctness, regression, and design alignment",
    lenses: ["correctness_regression", "architecture_design", "security_data"] as const,
    requiredLenses: ["correctness_regression", "architecture_design", "security_data"],
    passingThreshold: 0.8, // 80% score to pass
  },
  full: {
    id: "full",
    name: "Full Review",
    description: "Comprehensive review across all lenses",
    lenses: [
      "correctness_regression",
      "architecture_design",
      "security_data",
      "performance_resources",
      "maintainability_style",
      "test_adequacy",
      "documentation_migration",
    ] as const,
    requiredLenses: [
      "correctness_regression",
      "architecture_design",
      "security_data",
      "performance_resources",
      "maintainability_style",
      "test_adequacy",
      "documentation_migration",
    ],
    passingThreshold: 0.85,
  },
};

/**
 * Score findings against rubric
 */
export function scoreFindings(findings: any[], criteria: typeof DEFAULT_RUBRIC_CRITERIA): ReviewScore {
  const scores: Record<string, { score: number; max: number }> = {};
  
  // Initialize lens scores
  for (const criterion of criteria) {
    if (!scores[criterion.lens]) {
      scores[criterion.lens] = { score: 0, max: 0 };
    }
    const scoreEntry = scores[criterion.lens];
    if (scoreEntry) {
      scoreEntry.max += criterion.weight;
    }
  }
  
  // Deduct points for findings
  for (const finding of findings) {
    const relevantCriteria = criteria.filter(c => c.lens === finding.lens);
    
    for (const criterion of relevantCriteria) {
      const severityValue = getSeverityValue(finding.severity);
      const maxSeverityValue = 4; // critical = 4
      
      // Deduct proportional to severity and weight
      const deduction = (severityValue / maxSeverityValue) * criterion.weight;
      const scoreEntry = scores[finding.lens];
      if (scoreEntry) {
        scoreEntry.score -= deduction;
      }
    }
  }
  
  // Normalize scores (floor at 0)
  for (const lens of Object.keys(scores)) {
    const scoreEntry = scores[lens];
    if (scoreEntry) {
      scoreEntry.score = Math.max(0, scoreEntry.score);
    }
  }
  
  const total = Object.values(scores).reduce((sum, s) => sum + s.score, 0);
  const maxPossible = Object.values(scores).reduce((sum, s) => sum + s.max, 0);
  
  // Determine if passed (using quick profile threshold)
  const passed = total / maxPossible >= 0.8;
  
  return {
    total,
    maxPossible,
    byLens: scores,
    passed,
  };
}

function getSeverityValue(severity: string): number {
  const values: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    informational: 0,
  };
  return values[severity] ?? 0;
}

/**
 * Get review profile
 */
export function getReviewProfile(profile: "quick" | "full"): typeof REVIEW_PROFILES.quick | typeof REVIEW_PROFILES.full {
  return REVIEW_PROFILES[profile];
}

/**
 * Check if review passes
 */
export function doesReviewPass(findings: any[], profile: "quick" | "full"): boolean {
  const criteria = DEFAULT_RUBRIC_CRITERIA;
  const score = scoreFindings(findings, criteria);
  const threshold = REVIEW_PROFILES[profile].passingThreshold;
  return score.total / score.maxPossible >= threshold;
}