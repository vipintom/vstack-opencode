/**
 * Project Verification Skill Generator
 * 
 * Discovers project structure and generates project-specific verification skills.
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";

export interface ProjectVerificationConfig {
  projectName: string;
  projectType: "web" | "api" | "cli" | "desktop" | "mobile" | "service" | "library";
  primaryLanguage: string;
  packageManager: "npm" | "yarn" | "pnpm" | "pip" | "cargo" | "go" | "maven" | "gradle";
  testFramework: string;
  requiredServices: string[];
  envVars: string;
  configFiles: string;
  testFixtures: string;
  surfaces: Array<{
    name: string;
    description: string;
    url: string;
    healthCheck: string;
  }>;
  setupCommands: string;
  runCommands: string;
  healthCommands: string;
  driveMethods: Array<{
    name: string;
    description: string;
    command: string;
    testIdentity: string;
    safeTestData: string;
  }>;
  observeMethods: Array<{
    name: string;
    description: string;
    expected: string;
    logs: string;
    metrics: string;
  }>;
  cleanupCommands: string;
  gaps: Array<{
    area: string;
    description: string;
    manualSteps: string;
    flaky: string;
  }>;
  representativeScenario: string;
  validationEvidence: string;
  leadReviewer: string;
  validationDate: string;
}

export interface DiscoveryResult {
  packageJson?: any;
  projectType: "web" | "api" | "cli" | "desktop" | "mobile" | "service" | "library";
  primaryLanguage: string;
  packageManager: string;
  testFramework: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  entryPoints: string[];
  testFiles: string[];
  configFiles: string[];
}

export async function discoverProject(projectRoot: string): Promise<DiscoveryResult> {
  const packageJsonPath = resolve(projectRoot, "package.json");
  let packageJson: any = null;
  
  if (existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    } catch {
      // ignore parse errors
    }
  }
  
  // Detect project type
  let projectType: DiscoveryResult["projectType"] = "service";
  let primaryLanguage = "javascript";
  let packageManager = "npm";
  let testFramework = "vitest";
  let scripts: Record<string, string> = {};
  let dependencies: Record<string, string> = {};
  let devDependencies: Record<string, string> = {};
  let entryPoints: string[] = [];
  let testFiles: string[] = [];
  let configFiles: string[] = [];
  
  if (packageJson) {
    scripts = packageJson.scripts || {};
    dependencies = packageJson.dependencies || {};
    devDependencies = packageJson.devDependencies || {};
    
    // Detect package manager
    if (existsSync(resolve(projectRoot, "pnpm-lock.yaml"))) packageManager = "pnpm";
    else if (existsSync(resolve(projectRoot, "yarn.lock"))) packageManager = "yarn";
    else if (existsSync(resolve(projectRoot, "package-lock.json"))) packageManager = "npm";
    
    // Detect test framework
    if (devDependencies.vitest || dependencies.vitest) testFramework = "vitest";
    else if (devDependencies.jest || dependencies.jest) testFramework = "jest";
    else if (devDependencies.mocha || dependencies.mocha) testFramework = "mocha";
    else if (devDependencies.cypress || dependencies.cypress) testFramework = "cypress";
    else if (devDependencies.playwright || dependencies.playwright) testFramework = "playwright";
    
    // Detect project type from dependencies
    if (dependencies.react || dependencies.vue || dependencies.svelte || dependencies.next || dependencies.nuxt) {
      projectType = "web";
    } else if (dependencies.express || dependencies.fastify || dependencies.hono || dependencies.koa) {
      projectType = "api";
    } else if (dependencies["@tauri-apps/api"] || dependencies.electron) {
      projectType = "desktop";
    } else if (dependencies["react-native"] || dependencies.expo) {
      projectType = "mobile";
    } else if (scripts.build || scripts.compile) {
      projectType = "library";
    } else {
      projectType = "cli";
    }
    
    // Find entry points
    const possibleEntries = ["src/index.ts", "src/main.ts", "src/app.ts", "index.ts", "main.ts", "server.ts"];
    for (const entry of possibleEntries) {
      if (existsSync(resolve(projectRoot, entry))) {
        entryPoints.push(entry);
      }
    }
    
    // Find test files
    const findTestFiles = (dir: string) => {
      try {
        const files = readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          const fullPath = resolve(dir, file.name);
          if (file.isDirectory() && !file.name.startsWith(".") && file.name !== "node_modules") {
            findTestFiles(fullPath);
          } else if (file.name.endsWith(".test.ts") || file.name.endsWith(".test.js") || 
                     file.name.endsWith(".spec.ts") || file.name.endsWith(".spec.js")) {
            testFiles.push(fullPath.replace(projectRoot + "/", ""));
          }
        }
      } catch {
        // ignore
      }
    };
    findTestFiles(resolve(projectRoot, "src"));
    findTestFiles(resolve(projectRoot, "tests"));
    
    // Find config files
    const configPatterns = ["*.config.js", "*.config.ts", "*.config.json", "tsconfig.json", "vitest.config.*", "jest.config.*"];
    // Simplified - just check common ones
    const commonConfigs = ["tsconfig.json", "vitest.config.ts", "jest.config.js", "playwright.config.ts", "cypress.config.ts"];
    for (const config of commonConfigs) {
      if (existsSync(resolve(projectRoot, config))) {
        configFiles.push(config);
      }
    }
  }
  
  return {
    packageJson,
    projectType,
    primaryLanguage,
    packageManager,
    testFramework,
    scripts,
    dependencies,
    devDependencies,
    entryPoints,
    testFiles,
    configFiles,
  };
}

function renderTemplate(template: string, config: ProjectVerificationConfig): string {
  let result = template;
  
  // Simple template rendering
  result = result.replace(/\{\{projectName\}\}/g, config.projectName);
  result = result.replace(/\{\{projectType\}\}/g, config.projectType);
  result = result.replace(/\{\{primaryLanguage\}\}/g, config.primaryLanguage);
  result = result.replace(/\{\{packageManager\}\}/g, config.packageManager);
  result = result.replace(/\{\{testFramework\}\}/g, config.testFramework);
  result = result.replace(/\{\{requiredServices\}\}/g, config.requiredServices.join("\n- "));
  result = result.replace(/\{\{envVars\}\}/g, config.envVars);
  result = result.replace(/\{\{configFiles\}\}/g, config.configFiles);
  result = result.replace(/\{\{testFixtures\}\}/g, config.testFixtures);
  result = result.replace(/\{\{setupCommands\}\}/g, config.setupCommands);
  result = result.replace(/\{\{runCommands\}\}/g, config.runCommands);
  result = result.replace(/\{\{healthCommands\}\}/g, config.healthCommands);
  result = result.replace(/\{\{cleanupCommands\}\}/g, config.cleanupCommands);
  result = result.replace(/\{\{representativeScenario\}\}/g, config.representativeScenario);
  result = result.replace(/\{\{validationEvidence\}\}/g, config.validationEvidence);
  result = result.replace(/\{\{leadReviewer\}\}/g, config.leadReviewer);
  result = result.replace(/\{\{validationDate\}\}/g, config.validationDate);
  result = result.replace(/\{\{generationDate\}\}/g, new Date().toISOString().split("T")[0] ?? "");
  result = result.replace(/\{\{vstackVersion\}\}/g, "2.0.0");
  
  // Render arrays
  const surfacesHtml = config.surfaces.map(s => 
    `- **${s.name}:** ${s.description}\n  - URL/Endpoint: ${s.url}\n  - Health Check: ${s.healthCheck}`
  ).join("\n");
  result = result.replace(/\{\{#each surfaces\}\}[\s\S]*?\{\{\/each\}\}/g, surfacesHtml);
  
  const driveHtml = config.driveMethods.map(d => 
    `- **${d.name}:** ${d.description}\n  - Command: ${d.command}\n  - Test Identity: ${d.testIdentity}\n  - Safe Test Data: ${d.safeTestData}`
  ).join("\n");
  result = result.replace(/\{\{#each driveMethods\}\}[\s\S]*?\{\{\/each\}\}/g, driveHtml);
  
  const observeHtml = config.observeMethods.map(o => 
    `- **${o.name}:** ${o.description}\n  - Expected: ${o.expected}\n  - Logs: ${o.logs}\n  - Metrics: ${o.metrics}`
  ).join("\n");
  result = result.replace(/\{\{#each observeMethods\}\}[\s\S]*?\{\{\/each\}\}/g, observeHtml);
  
  const gapsHtml = config.gaps.map(g => 
    `- **${g.area}}:** ${g.description}\n  - Manual Verification: ${g.manualSteps}\n  - Known Flaky: ${g.flaky}`
  ).join("\n");
  result = result.replace(/\{\{#each gaps\}\}[\s\S]*?\{\{\/each\}\}/g, gapsHtml);
  
  return result;
}

export async function generateVerificationSkill(
  projectRoot: string,
  outputDir: string,
  customConfig?: Partial<ProjectVerificationConfig>
): Promise<string> {
  const discovery = await discoverProject(projectRoot);
  
  // Load template
  const templatePath = resolve(__dirname, "../../../playbook/project-templates/verification-skill/SKILL.md.hbs");
  let template = "";
  if (existsSync(templatePath)) {
    template = readFileSync(templatePath, "utf-8");
  } else {
    // Fallback minimal template
    template = `# {{projectName}} Verification Skill

## Project Overview

**Project:** {{projectName}}
**Type:** {{projectType}}
**Primary Language:** {{primaryLanguage}}
**Package Manager:** {{packageManager}}
**Test Framework:** {{testFramework}}

## Prerequisites

### Required Services
{{#each requiredServices}}
- {{this}}
{{/each}}

### Configuration
- **Environment Variables:** {{envVars}}
- **Config Files:** {{configFiles}}
- **Test Data/Fixtures:** {{testFixtures}}

## Commands

### Install
\`\`\`bash
{{installCommand}}
\`\`\`

### Build
\`\`\`bash
{{buildCommand}}
\`\`\`

### Start Development
\`\`\`bash
{{devCommand}}
\`\`\`

### Run Tests
\`\`\`bash
{{testCommand}}
\`\`\`

## Application Surfaces

### {{projectType}}
{{#each surfaces}}
- **{{name}}:** {{description}}
  - URL/Endpoint: {{url}}
  - Health Check: {{healthCheck}}
{{/each}}

## Verification Sections

### 1. Setup
\`\`\`bash
{{setupCommands}}
\`\`\`

### 2. Run
\`\`\`bash
{{runCommands}}
\`\`\`

### 3. Health
\`\`\`bash
{{healthCommands}}
\`\`\`

### 4. Drive
{{#each driveMethods}}
- **{{name}}:** {{description}}
  - Command: {{command}}
  - Test Identity: {{testIdentity}}
  - Safe Test Data: {{safeTestData}}
{{/each}}

### 5. Observe
{{#each observeMethods}}
- **{{name}}:** {{description}}
  - Expected: {{expected}}
  - Logs: {{logs}}
  - Metrics: {{metrics}}
{{/each}}

### 6. Cleanup
\`\`\`bash
{{cleanupCommands}}
\`\`\`

## Gaps & Limitations

{{#each gaps}}
- **{{area}}:** {{description}}
  - Manual Verification: {{manualSteps}}
  - Known Flaky: {{flaky}}
{{/each}}

## Validation

- **Representative Scenario:** {{representativeScenario}}
- **Validation Evidence:** {{validationEvidence}}
- **Lead/Reviewer:** {{leadReviewer}}
- **Date:** {{validationDate}}

---

*Generated by vstack-create-verification on {{generationDate}}*
*vstack Version: {{vstackVersion}}*`;
  }
  
  // Build config from discovery + custom config
  const installCommand = discovery.scripts.install || (discovery.packageManager === "pnpm" ? "pnpm install" : 
    discovery.packageManager === "yarn" ? "yarn install" : "npm install");
  const buildCommand = discovery.scripts.build || "";
  const devCommand = discovery.scripts.dev || discovery.scripts.start || "";
  const testCommand = discovery.scripts.test || (discovery.testFramework === "vitest" ? "npx vitest run" :
    discovery.testFramework === "jest" ? "npx jest" : "npm test");
  const testSuiteCommand = discovery.scripts["test:unit"] || discovery.scripts["test:integration"] || "";
  
  const config: ProjectVerificationConfig = {
    projectName: customConfig?.projectName || discovery.packageJson?.name || "project",
    projectType: customConfig?.projectType || discovery.projectType,
    primaryLanguage: customConfig?.primaryLanguage || discovery.primaryLanguage,
    packageManager: (customConfig?.packageManager || discovery.packageManager) as "npm" | "yarn" | "pnpm" | "pip" | "cargo" | "go" | "maven" | "gradle",
    testFramework: customConfig?.testFramework || discovery.testFramework,
    requiredServices: customConfig?.requiredServices || [],
    envVars: customConfig?.envVars || "See .env.example",
    configFiles: customConfig?.configFiles || discovery.configFiles.join(", "),
    testFixtures: customConfig?.testFixtures || "tests/fixtures/",
    surfaces: customConfig?.surfaces || [
      { name: "Main Application", description: "Primary application surface", url: "http://localhost:3000", healthCheck: "GET /health" }
    ],
    setupCommands: customConfig?.setupCommands || `${installCommand}\n${buildCommand}`,
    runCommands: customConfig?.runCommands || devCommand,
    healthCommands: customConfig?.healthCommands || "curl http://localhost:3000/health",
    driveMethods: customConfig?.driveMethods || [
      { name: "API Testing", description: "Test API endpoints", command: testCommand, testIdentity: "test-user", safeTestData: "Use test database" }
    ],
    observeMethods: customConfig?.observeMethods || [
      { name: "Test Results", description: "Check test output", expected: "All tests pass", logs: "Test runner output", metrics: "Coverage report" }
    ],
    cleanupCommands: customConfig?.cleanupCommands || "pkill -f 'node.*dev' || true",
    gaps: customConfig?.gaps || [
      { area: "E2E Tests", description: "Full user journey testing", manualSteps: "Run Playwright/Cypress manually", flaky: "May be flaky on CI" }
    ],
    representativeScenario: customConfig?.representativeScenario || "User registration and login flow",
    validationEvidence: customConfig?.validationEvidence || "Test run output, coverage report",
    leadReviewer: customConfig?.leadReviewer || "vstack-lead",
    validationDate: customConfig?.validationDate || (new Date().toISOString().split("T")[0] ?? ""),
  };
  
  // Render template
  const rendered = renderTemplate(template, config);
  
  // Write output
  const outputPath = resolve(outputDir, `${config.projectName}-verification.md`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered, "utf-8");
  
  return outputPath;
}

export async function validateVerificationSkill(skillPath: string): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  
  if (!existsSync(skillPath)) {
    errors.push(`Skill file not found: ${skillPath}`);
    return { valid: false, errors };
  }
  
  const content = readFileSync(skillPath, "utf-8");
  
  // Check required sections
  const requiredSections = [
    "Project Overview",
    "Prerequisites",
    "Commands",
    "Application Surfaces",
    "Verification Sections",
    "Setup",
    "Run",
    "Health",
    "Drive",
    "Observe",
    "Cleanup",
    "Gaps & Limitations",
    "Validation",
  ];
  
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      errors.push(`Missing required section: ${section}`);
    }
  }
  
  // Check for placeholder values
  const placeholders = ["{{projectName}}", "{{projectType}}", "{{installCommand}}", "{{testCommand}}"];
  for (const placeholder of placeholders) {
    if (content.includes(placeholder)) {
      errors.push(`Unrendered placeholder: ${placeholder}`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}