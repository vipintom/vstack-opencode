/**
 * Test execution and management
 * Handles unit, integration, and E2E test execution
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Evidence, EvidenceType, EvidenceSource, EvidenceId, evidenceId, deliveryId, taskId, phaseRunId } from "../schemas/types.js";
import { readJsonFile, writeJsonFile } from "../persistence/file-store.js";
import { appendEvent } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface TestConfig {
  suites: TestSuite[];
  timeout: number;
  coverageThreshold?: number;
  maxParallel: number;
}

export interface TestSuite {
  id: string;
  name: string;
  type: "unit" | "integration" | "e2e";
  command: string[];
  workingDirectory: string;
  timeout: number;
  required: boolean;
  coverageEnabled: boolean;
  coverageThreshold?: number;
  retryPolicy: RetryPolicy;
}

export interface RetryPolicy {
  maxRetries: number;
  retryDelay: number;
  retryOn: ("failed" | "flaky" | "timeout")[];
}

export interface TestResult {
  suiteId: string;
  status: "passed" | "failed" | "skipped" | "error" | "timeout" | "cancelled";
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;
  coverage?: CoverageResult;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  completedAt: string;
  evidenceId: EvidenceId | null;
}

export interface CoverageResult {
  lines: { total: number; covered: number; percentage: number };
  functions: { total: number; covered: number; percentage: number };
  branches: { total: number; covered: number; percentage: number };
  statements: { total: number; covered: number; percentage: number };
}

export interface TestRunSummary {
  totalSuites: number;
  passedSuites: number;
  failedSuites: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  overallCoverage?: CoverageResult;
  duration: number;
}

/**
 * Create test manager
 */
export async function createTestManager(paths: VstackPaths) {
  return {
    /**
     * Discover test configuration from project
     */
    async discoverTestConfig(projectRoot: string): Promise<TestConfig> {
      const fs = await import("node:fs");
      const suites: TestSuite[] = [];
      
      // Check package.json
      const packageJsonPath = resolve(projectRoot, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        const scripts = pkg.scripts ?? {};
        
        if (scripts.test) {
          suites.push({
            id: "test:unit",
            name: "Unit Tests",
            type: "unit",
            command: ["npm", "test"],
            workingDirectory: projectRoot,
            timeout: 180000,
            required: true,
            coverageEnabled: !!pkg.jest || !!pkg.vitest || pkg.scripts?.coverage,
            coverageThreshold: pkg.jest?.coverageThreshold?.global?.statements || 80,
            retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["flaky", "failed"] },
          });
        }
        
        if (scripts["test:unit"]) {
          suites.push({
            id: "test:unit",
            name: "Unit Tests",
            type: "unit",
            command: ["npm", "run", "test:unit"],
            workingDirectory: projectRoot,
            timeout: 180000,
            required: true,
            coverageEnabled: true,
            retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["flaky", "failed"] },
          });
        }
        
        if (scripts["test:integration"]) {
          suites.push({
            id: "test:integration",
            name: "Integration Tests",
            type: "integration",
            command: ["npm", "run", "test:integration"],
            workingDirectory: projectRoot,
            timeout: 300000,
            required: false,
            coverageEnabled: false,
            retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["flaky", "failed"] },
          });
        }
        
        if (scripts["test:e2e"]) {
          suites.push({
            id: "test:e2e",
            name: "E2E Tests",
            type: "e2e",
            command: ["npm", "run", "test:e2e"],
            workingDirectory: projectRoot,
            timeout: 600000,
            required: false,
            coverageEnabled: false,
            retryPolicy: { maxRetries: 1, retryDelay: 15000, retryOn: ["flaky", "failed"] },
          });
        }
      }
      
      // Check for pytest
      if (fs.existsSync(resolve(projectRoot, "pytest.ini")) || 
          fs.existsSync(resolve(projectRoot, "pyproject.toml"))) {
        suites.push({
          id: "test:python",
          name: "Python Tests",
          type: "unit",
          command: ["python", "-m", "pytest"],
          workingDirectory: projectRoot,
          timeout: 300000,
          required: true,
          coverageEnabled: true,
          retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["flaky", "failed"] },
        });
      }
      
      // Check for Cargo (Rust)
      if (fs.existsSync(resolve(projectRoot, "Cargo.toml"))) {
        suites.push({
          id: "test:rust",
          name: "Rust Tests",
          type: "unit",
          command: ["cargo", "test"],
          workingDirectory: projectRoot,
          timeout: 300000,
          required: true,
          coverageEnabled: false,
          retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["flaky", "failed"] },
        });
      }
      
      // Check for Go
      if (fs.existsSync(resolve(projectRoot, "go.mod"))) {
        suites.push({
          id: "test:go",
          name: "Go Tests",
          type: "unit",
          command: ["go", "test", "./..."],
          workingDirectory: projectRoot,
          timeout: 300000,
          required: true,
          coverageEnabled: true,
          retryPolicy: { maxRetries: 1, retryDelay: 10000, retryOn: ["flaky", "failed"] },
        });
      }
      
      return {
        suites,
        timeout: 300000,
        maxParallel: 3,
      };
    },
    
    /**
     * Run test suite
     */
    async runTestSuite(
      suite: TestSuite,
      deliveryId: string,
      taskId: string | null,
      phaseRunId: string | null,
      commitRef: string
    ): Promise<TestResult> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      
      const result = await executeCommand(suite.command, {
        cwd: suite.workingDirectory,
        timeout: suite.timeout,
        env: { ...process.env, CI: "true" },
      });
      
      const completedAt = new Date().toISOString();
      const duration = Date.now() - startedMs;
      
      // Parse test output for counts
      const counts = parseTestOutput(result.stdout, result.stderr);
      
      // Create evidence
      const evidenceIdValue = evidenceId(`evd_${randomUUID().replace(/-/g, "").slice(0, 16)}`);
      const evidence: Evidence = {
        schemaVersion: 1,
        id: evidenceIdValue,
        deliveryId: deliveryId as any,
        taskId: taskId as any,
        phaseRunId: phaseRunId as any,
        type: suite.type === "unit" ? "test:unit" : (suite.type === "integration" ? "test:integration" : "test:e2e"),
        source: "plugin_execution",
        provenance: "plugin_observed",
        outcome: result.exitCode === 0 ? "passed" : (result.timedOut ? "blocked" : "failed"),
        checkId: suite.id,
        command: suite.command,
        workingDirectory: suite.workingDirectory,
        commitRef,
        startedAt,
        completedAt,
        exitCode: result.exitCode,
        status: result.timedOut ? "timeout" : (result.exitCode === 0 ? "passed" : "failed"),
        stdoutPath: null,
        stderrPath: null,
        summary: `${suite.name}: ${counts.passed}/${counts.total} passed`,
        executionId: `exec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        sessionId: null,
        agentRunId: null,
        metadata: {
          duration,
          totalTests: counts.total,
          passedTests: counts.passed,
          failedTests: counts.failed,
          skippedTests: counts.skipped,
        },
        revision: 0,
      };
      
      return {
        suiteId: suite.id,
        status: evidence.status,
        totalTests: counts.total,
        passedTests: counts.passed,
        failedTests: counts.failed,
        skippedTests: counts.skipped,
        duration,
        coverage: undefined, // Would parse coverage report
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        startedAt,
        completedAt,
        evidenceId: evidenceIdValue,
      };
    },
    
    /**
     * Run all test suites
     */
    async runAllTests(
      config: TestConfig,
      deliveryId: string,
      taskId: string | null,
      phaseRunId: string | null,
      commitRef: string
    ): Promise<TestRunSummary> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      
      const results: TestResult[] = [];
      
      // Run suites with limited parallelism
      for (const suite of config.suites) {
        if (!suite.required && config.suites.some(s => s.required && results.some(r => r.status === "failed"))) {
          // Skip optional suites if required ones failed
          continue;
        }
        
        const result = await this.runTestSuite(suite, deliveryId, taskId, phaseRunId, commitRef);
        results.push(result);
      }
      
      const completedAt = new Date().toISOString();
      const duration = Date.now() - startedMs;
      
      // Calculate summary
      const summary: TestRunSummary = {
        totalSuites: results.length,
        passedSuites: results.filter(r => r.status === "passed").length,
        failedSuites: results.filter(r => r.status === "failed").length,
        totalTests: results.reduce((sum, r) => sum + r.totalTests, 0),
        passedTests: results.reduce((sum, r) => sum + r.passedTests, 0),
        failedTests: results.reduce((sum, r) => sum + r.failedTests, 0),
        overallCoverage: undefined,
        duration,
      };
      
      return summary;
    },
  };
}

/**
 * Execute command
 */
async function executeCommand(
  command: string[],
  options: { cwd: string; timeout: number; env: Record<string, string> }
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const [cmd, ...args] = command;
  if (!cmd) {
    return { exitCode: -1, stdout: "", stderr: "Empty command", timedOut: false };
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    
    if (child.stdout) {
      child.stdout.on("data", (data) => { stdout += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on("data", (data) => { stderr += data.toString(); });
    }
    
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeout);
    
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
    
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr: err.message, timedOut: false });
    });
  });
}

/**
 * Parse test output for counts
 */
function parseTestOutput(stdout: string, stderr: string): { total: number; passed: number; failed: number; skipped: number } {
  // Try common test output patterns
  const patterns = [
    // Jest: Test Suites: 1 passed, 1 total; Tests: 3 passed, 3 total
    /Tests?:\s*(\d+)\s*(?:passed|failed|skipped)/gi,
    // Vitest: Test Files  1 passed (1); Tests  3 passed (3)
    /Tests\s+(\d+)\s+passed/gi,
    // Pytest: 3 passed, 1 failed, 2 skipped
    /(\d+)\s+(passed|failed|skipped)/gi,
    // Go test: PASS/FAIL with counts
    /(PASS|FAIL)\s+.*?(\d+)/gi,
    // Cargo test: test result: ok. 3 passed; 0 failed
    /test result:.*?(\d+)\s+passed/gi,
  ];
  
  let total = 0, passed = 0, failed = 0, skipped = 0;
  
  const output = stdout + "\n" + stderr;
  
  for (const pattern of patterns) {
    const matches = [...output.matchAll(pattern)];
    for (const match of matches) {
      if (match[1]) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num)) {
          if (match[0].includes("passed")) passed += num;
          else if (match[0].includes("failed")) failed += num;
          else if (match[0].includes("skipped")) skipped += num;
          else total += num;
        }
      }
    }
  }
  
  // If we couldn't parse, estimate from exit code
  if (total === 0 && passed === 0 && failed === 0) {
    // Default assumption
    total = 1;
    passed = 0;
    failed = 1;
  }
  
  total = Math.max(total, passed + failed + skipped);
  
  return { total, passed, failed, skipped };
}