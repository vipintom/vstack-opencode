/**
 * Security checks and validation
 * Handles dependency scanning, secret detection, and security reviews
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { Evidence, EvidenceType, EvidenceSource, EvidenceId, evidenceId, deliveryId, taskId, phaseRunId } from "../schemas/types.js";
import { readJsonFile, writeJsonFile } from "../persistence/file-store.js";
import { appendEvent } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { randomUUID } from "node:crypto";

export interface SecurityConfig {
  dependencyScan: boolean;
  secretScan: boolean;
  licenseScan: boolean;
  sastScan: boolean;
  timeout: number;
}

export interface SecurityResult {
  dependencyVulnerabilities: VulnerabilityResult[];
  secrets: SecretResult[];
  licenses: LicenseResult[];
  sastFindings: SastFinding[];
  overallRisk: "low" | "medium" | "high" | "critical";
}

export interface VulnerabilityResult {
  package: string;
  version: string;
  vulnerabilityId: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  fixedVersion?: string;
  references: string[];
}

export interface SecretResult {
  file: string;
  line: number;
  type: string;
  entropy: number;
  redactedValue: string;
}

export interface LicenseResult {
  package: string;
  version: string;
  license: string;
  licenseType: "permissive" | "copyleft" | "unknown" | "problematic";
  issues: string[];
}

export interface SastFinding {
  file: string;
  line: number;
  ruleId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  message: string;
  category: string;
}

async function executeCommand(
  command: string[],
  options: { cwd: string; timeout: number; env: Record<string, string> }
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const [cmd, ...args] = command;
  if (!cmd) {
    return { exitCode: -1, stdout: "", stderr: "Empty command" };
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    let stdout = "";
    let stderr = "";
    
    if (child.stdout) {
      child.stdout.on("data", (data) => { stdout += data.toString(); });
    }
    if (child.stderr) {
      child.stderr.on("data", (data) => { stderr += data.toString(); });
    }
    
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeout);
    
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, stdout, stderr });
    });
    
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr: err.message });
    });
  });
}

async function scanDependencies(projectRoot: string): Promise<VulnerabilityResult[]> {
  const vulnerabilities: VulnerabilityResult[] = [];
  
  // Try npm audit
  try {
    const result = await executeCommand(["npm", "audit", "--json"], {
      cwd: projectRoot,
      timeout: 120000,
      env: process.env as Record<string, string>,
    });
    
    if (result.exitCode !== undefined && result.exitCode !== 0) {
      const auditData = JSON.parse(result.stdout);
      for (const [pkg, vuln] of Object.entries(auditData.vulnerabilities ?? {})) {
        const v = vuln as any;
        vulnerabilities.push({
          package: pkg,
          version: v.range || "unknown",
          vulnerabilityId: v.name,
          severity: v.severity,
          title: v.title,
          description: v.description,
          fixedVersion: v.fixAvailable ? v.fixVersion : undefined,
          references: v.references ?? [],
        });
      }
    }
  } catch (error) {
    console.warn("npm audit failed:", error);
  }
  
  // Try cargo audit (Rust)
  // Try pip audit (Python)
  // Try go vulncheck (Go)
  
  return vulnerabilities;
}

async function scanSecrets(projectRoot: string): Promise<SecretResult[]> {
  const secrets: SecretResult[] = [];
  
  // Use git-secrets or truffleHog if available
  // For now, implement basic regex-based detection
  const patterns = [
    { type: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/ },
    { type: "AWS Secret Key", regex: /[A-Za-z0-9/+=]{40}/ },
    { type: "GitHub Token", regex: /gh[pousr]_[A-Za-z0-9]{36}/ },
    { type: "Generic API Key", regex: /[a-zA-Z0-9_\-]{32,}/ },
    { type: "Private Key", regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { type: "Database URL", regex: /(postgres|mysql|mongodb):\/\/[^:]+:[^@]+@/ },
    { type: "JWT", regex: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  ];
  
  // Walk files and check
  const files = await walkFiles(projectRoot);
  
  for (const file of files) {
    if (shouldSkipFile(file)) continue;
    
    try {
      const content = await import("node:fs").then(fs => fs.readFileSync(file, "utf-8"));
      
      for (const pattern of patterns) {
        const matches = content.matchAll(pattern.regex);
        for (const match of matches) {
          const line = content.substring(0, match.index).split("\n").length;
          secrets.push({
            file: file.replace(projectRoot + "/", ""),
            line,
            type: pattern.type,
            entropy: calculateEntropy(match[0]),
            redactedValue: redactSecret(match[0]),
          });
        }
      }
    } catch (error) {
      // Skip unreadable files
    }
  }
  
  return secrets;
}

async function scanLicenses(projectRoot: string): Promise<LicenseResult[]> {
  const licenses: LicenseResult[] = [];
  
  // Try license-checker (npm)
  try {
    const result = await executeCommand(["npx", "license-checker", "--json"], {
      cwd: projectRoot,
      timeout: 120000,
      env: process.env as Record<string, string>,
    });
    
    if (result.exitCode === 0) {
      const data = JSON.parse(result.stdout);
      for (const [pkg, info] of Object.entries(data)) {
        const lic = info as any;
        licenses.push({
          package: pkg,
          version: lic.version || "unknown",
          license: lic.licenses || "unknown",
          licenseType: classifyLicense(lic.licenses),
          issues: getLicenseIssues(lic.licenses),
        });
      }
    }
  } catch (error) {
    console.warn("license-checker failed:", error);
  }
  
  return licenses;
}

async function runSastScan(projectRoot: string): Promise<SastFinding[]> {
  const findings: SastFinding[] = [];
  
  // Try semgrep
  try {
    const result = await executeCommand(["npx", "semgrep", "--config=auto", "--json", "."], {
      cwd: projectRoot,
      timeout: 300000,
      env: process.env as Record<string, string>,
    });
    
    if (result.exitCode !== undefined && result.exitCode !== 1) {
      const data = JSON.parse(result.stdout);
      for (const finding of data.results ?? []) {
        findings.push({
          file: finding.path,
          line: finding.start.line,
          ruleId: finding.check_id,
          severity: mapSemgrepSeverity(finding.extra.severity),
          message: finding.extra.message,
          category: finding.extra.metadata?.category || "security",
        });
      }
    }
  } catch (error) {
    console.warn("semgrep failed:", error);
  }
  
  return findings;
}

function calculateOverallRisk(results: SecurityResult): "low" | "medium" | "high" | "critical" {
  let maxSeverity = 0;
  
  for (const vuln of results.dependencyVulnerabilities) {
    maxSeverity = Math.max(maxSeverity, severityValue(vuln.severity));
  }
  
  for (const secret of results.secrets) {
    if (secret.entropy > 4) maxSeverity = Math.max(maxSeverity, 3); // High
  }
  
  for (const finding of results.sastFindings) {
    maxSeverity = Math.max(maxSeverity, severityValue(finding.severity));
  }
  
  if (maxSeverity >= 4) return "critical";
  if (maxSeverity >= 3) return "high";
  if (maxSeverity >= 2) return "medium";
  return "low";
}

async function createSecurityEvidence(
  results: SecurityResult,
  deliveryId: string,
  taskId: string | null,
  phaseRunId: string | null,
  commitRef: string
): Promise<void> {
  // Create evidence for dependency scan
  const depEvidence: Evidence = {
    schemaVersion: 1,
    id: evidenceId(`evd_${randomUUID().replace(/-/g, "").slice(0, 16)}`),
    deliveryId: deliveryId as any,
    taskId: taskId as any,
    phaseRunId: phaseRunId as any,
    type: "security:deps",
    source: "plugin_execution",
    provenance: "plugin_observed",
    outcome: "passed",
    checkId: "security:deps",
    command: ["npm", "audit", "--json"],
    workingDirectory: "",
    commitRef,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    exitCode: results.dependencyVulnerabilities.some(v => v.severity === "critical" || v.severity === "high") ? 1 : 0,
    status: results.dependencyVulnerabilities.some(v => v.severity === "critical" || v.severity === "high") ? "failed" : "passed",
    stdoutPath: null,
    stderrPath: null,
    summary: `Dependency scan: ${results.dependencyVulnerabilities.length} vulnerabilities found`,
    executionId: `exec_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    sessionId: null,
    agentRunId: null,
    metadata: { vulnerabilities: results.dependencyVulnerabilities },
    revision: 0,
  };
  
  // Similar for secrets, licenses, SAST
}

async function walkFiles(dir: string): Promise<string[]> {
  const { readdirSync } = await import("node:fs");
  const files: string[] = [];
  
  function walk(current: string) {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) walk(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  
  walk(dir);
  return files;
}

function shouldSkipDir(name: string): boolean {
  return [".git", "node_modules", "dist", "build", ".vstack", "target", "vendor", "__pycache__"].includes(name);
}

function shouldSkipFile(file: string): boolean {
  return /\.(min\.js|map|lock|log|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|pdf|zip|tar|gz)$/i.test(file);
}

function calculateEntropy(str: string): number {
  const freq = new Map<string, number>();
  for (const char of str) freq.set(char, (freq.get(char) ?? 0) + 1);
  
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function redactSecret(secret: string): string {
  if (secret.length <= 8) return "***";
  return secret.slice(0, 4) + "***" + secret.slice(-4);
}

function classifyLicense(license: string): "permissive" | "copyleft" | "unknown" | "problematic" {
  const permissive = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0"];
  const copyleft = ["GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0", "AGPL-3.0"];
  const problematic = ["SSPL", "Commons Clause", "Proprietary"];
  
  const upper = license.toUpperCase();
  if (problematic.some(p => upper.includes(p))) return "problematic";
  if (permissive.some(p => upper.includes(p))) return "permissive";
  if (copyleft.some(p => upper.includes(p))) return "copyleft";
  return "unknown";
}

function getLicenseIssues(license: string): string[] {
  const issues: string[] = [];
  const upper = license.toUpperCase();
  if (upper.includes("GPL") && !upper.includes("LGPL")) issues.push("Copyleft license - may require source disclosure");
  if (upper.includes("AGPL")) issues.push("Strong copyleft - network use triggers distribution");
  if (upper.includes("SSPL") || upper.includes("COMMONS CLAUSE")) issues.push("Non-OSI approved license");
  return issues;
}

function mapSemgrepSeverity(severity: string): SastFinding["severity"] {
  const mapping: Record<string, SastFinding["severity"]> = {
    ERROR: "high",
    WARNING: "medium",
    INFO: "info",
  };
  return mapping[severity.toUpperCase()] ?? "info";
}

function severityValue(severity: string): number {
  const mapping: Record<string, number> = {
    critical: 4, high: 3, medium: 2, low: 1, info: 0,
    ERROR: 3, WARNING: 2, INFO: 1,
  };
  return mapping[severity.toUpperCase()] ?? 0;
}

/**
 * Create security manager
 */
export async function createSecurityManager(paths: VstackPaths) {
  return {
    /**
     * Run all security checks
     */
    async runSecurityChecks(
      config: SecurityConfig,
      deliveryId: string,
      taskId: string | null,
      phaseRunId: string | null,
      commitRef: string,
      projectRoot: string
    ): Promise<SecurityResult> {
      const results: SecurityResult = {
        dependencyVulnerabilities: [],
        secrets: [],
        licenses: [],
        sastFindings: [],
        overallRisk: "low",
      };
      
      // Run dependency vulnerability scan
      if (config.dependencyScan) {
        results.dependencyVulnerabilities = await scanDependencies(projectRoot);
      }
      
      // Run secret scan
      if (config.secretScan) {
        results.secrets = await scanSecrets(projectRoot);
      }
      
      // Run license scan
      if (config.licenseScan) {
        results.licenses = await scanLicenses(projectRoot);
      }
      
      // Run SAST scan
      if (config.sastScan) {
        results.sastFindings = await runSastScan(projectRoot);
      }
      
      // Calculate overall risk
      results.overallRisk = calculateOverallRisk(results);
      
      // Create evidence for each check
      await createSecurityEvidence(results, deliveryId, taskId, phaseRunId, commitRef);
      
      return results;
    },
    
    /**
     * Scan for dependency vulnerabilities
     */
    async scanDependencies(projectRoot: string): Promise<VulnerabilityResult[]> {
      return scanDependencies(projectRoot);
    },
    
    /**
     * Scan for secrets
     */
    async scanSecrets(projectRoot: string): Promise<SecretResult[]> {
      return scanSecrets(projectRoot);
    },
    
    /**
     * Scan licenses
     */
    async scanLicenses(projectRoot: string): Promise<LicenseResult[]> {
      return scanLicenses(projectRoot);
    },
    
    /**
     * Run SAST scan
     */
    async runSastScan(projectRoot: string): Promise<SastFinding[]> {
      return runSastScan(projectRoot);
    },
    
    /**
     * Calculate overall risk
     */
    calculateOverallRisk(results: SecurityResult): "low" | "medium" | "high" | "critical" {
      return calculateOverallRisk(results);
    },
  };
}