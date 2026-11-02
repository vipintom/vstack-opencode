/**
 * Skill Authoring and Static Validation
 * 
 * Validates skill frontmatter, references, workflow integrity, and portability.
 */

import { resolve, join, extname } from "node:path";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  stats: ValidationStats;
}

export interface ValidationError {
  category: "skill" | "workflow" | "role" | "reference" | "portability" | "link" | "loop";
  file: string;
  message: string;
  severity: "error";
}

export interface ValidationWarning {
  category: "skill" | "workflow" | "role" | "reference" | "portability" | "link" | "loop";
  file: string;
  message: string;
  severity: "warning";
}

export interface ValidationStats {
  skillsChecked: number;
  workflowsChecked: number;
  rolesChecked: number;
  referencesChecked: number;
  linksChecked: number;
}

export interface SkillValidationConfig {
  playbookRoot: string;
  checkPortability: boolean;
  checkLinks: boolean;
  checkLoops: boolean;
  allowedHarnessReferences: string[];
}

function findFiles(dir: string, extension = ".md"): string[] {
  const results: string[] = [];
  function walk(current: string) {
    try {
      for (const entry of readdirSync(current)) {
        const full = join(current, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (extname(full) === extension) {
          results.push(full);
        }
      }
    } catch {
      // ignore
    }
  }
  walk(dir);
  return results;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match || !match[1]) return null;
  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) {
      fm[key.trim()] = rest.join(":").trim();
    }
  }
  return fm;
}

function extractSkillReferences(content: string): string[] {
  const refs = content.match(/`vstack-[\w-]+`/g) || [];
  return refs.map(r => r.replace(/`/g, ""));
}

function extractLinks(content: string): Array<{ url: string; line: number }> {
  const links: Array<{ url: string; line: number }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const markdownLinks = line.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
    for (const link of markdownLinks) {
      const urlMatch = link.match(/\(([^)]+)\)/);
      if (urlMatch && urlMatch[1]) links.push({ url: urlMatch[1], line: i + 1 });
    }
    const bareUrls = line.match(/https?:\/\/[^\s\)]+/g) || [];
    for (const url of bareUrls) {
      links.push({ url, line: i + 1 });
    }
  }
  return links;
}

function checkLoopSkillStopConditions(content: string, file: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  if (content.includes("loop") || content.includes("## Loop")) {
    if (!content.includes("## Stop Conditions")) {
      warnings.push({
        category: "loop",
        file,
        message: "Loop skill missing '## Stop Conditions' section",
        severity: "warning",
      });
    }
    if (!content.includes("escalat")) {
      warnings.push({
        category: "loop",
        file,
        message: "Loop skill should have escalation conditions",
        severity: "warning",
      });
    }
  }
  return warnings;
}

function checkPortability(content: string, file: string, allowedHarnessReferences: string[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const opencodePatterns = [
    /ctx\.skill/,
    /ctx\.agent/,
    /ctx\.tool/,
    /ctx\.session/,
    /ctx\.location/,
    /ctx\.project/,
    /`opencode_/,
    /opencode\./,
    /@opencode/,
  ];
  
  for (const pattern of opencodePatterns) {
    if (pattern.test(content)) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line && pattern.test(line)) {
          const context = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
          if (!context.includes("opencode-only") && !context.includes("OpenCode-specific")) {
            errors.push({
              category: "portability",
              file,
              message: `Potential OpenCode-specific reference may not be portable: ${line.trim().slice(0, 100)}`,
              severity: "error",
            });
          }
        }
      }
    }
  }
  
  return errors;
}

function checkLinks(links: Array<{ url: string; line: number }>, file: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  for (const link of links) {
    if (link.url.startsWith("./") || link.url.startsWith("../")) {
      warnings.push({
        category: "link",
        file,
        message: `Relative link at line ${link.line}: ${link.url} - verify target exists`,
        severity: "warning",
      });
    }
    if (link.url.includes("localhost")) {
      warnings.push({
        category: "link",
        file,
        message: `Localhost link at line ${link.line}: ${link.url} - may not work in all environments`,
        severity: "warning",
      });
    }
  }
  return warnings;
}

export async function validatePlaybook(config: SkillValidationConfig): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const stats: ValidationStats = {
    skillsChecked: 0,
    workflowsChecked: 0,
    rolesChecked: 0,
    referencesChecked: 0,
    linksChecked: 0,
  };
  
  const playbookRoot = config.playbookRoot;
  const skillsDir = join(playbookRoot, "skills");
  const workflowsDir = join(playbookRoot, "workflows");
  const rolesDir = join(playbookRoot, "agents", "roles");
  
  const skillNames = new Set<string>();
  const skillDirs = existsSync(skillsDir) 
    ? readdirSync(skillsDir).filter(d => statSync(join(skillsDir, d)).isDirectory())
    : [];
  
  for (const dir of skillDirs) {
    const skillPath = join(skillsDir, dir, "SKILL.md");
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, "utf-8");
      const fm = parseFrontmatter(content);
      if (fm && fm.name) skillNames.add(fm.name);
    }
  }
  
  // Validate Skills
  for (const dir of skillDirs) {
    stats.skillsChecked++;
    const skillPath = join(skillsDir, dir, "SKILL.md");
    if (!existsSync(skillPath)) {
      errors.push({
        category: "skill",
        file: skillPath,
        message: `Missing SKILL.md`,
        severity: "error",
      });
      continue;
    }
    
    const content = readFileSync(skillPath, "utf-8");
    const fm = parseFrontmatter(content);
    
    if (!fm) {
      errors.push({
        category: "skill",
        file: skillPath,
        message: "Missing frontmatter",
        severity: "error",
      });
      continue;
    }
    
    if (!fm.name) {
      errors.push({
        category: "skill",
        file: skillPath,
        message: "Missing 'name' in frontmatter",
        severity: "error",
      });
    }
    
    if (!fm.description) {
      warnings.push({
        category: "skill",
        file: skillPath,
        message: "Missing 'description' in frontmatter",
        severity: "warning",
      });
    }
    
    const requiredSections = ["## When to Use", "## Procedure", "## Expected Outputs", "## Verification", "## Stop Conditions"];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        warnings.push({
          category: "skill",
          file: skillPath,
          message: `Missing section '${section}'`,
          severity: "warning",
        });
      }
    }
    
    const loopWarnings = checkLoopSkillStopConditions(content, skillPath);
    warnings.push(...loopWarnings);
    
    if (config.checkPortability) {
      const portabilityErrors = checkPortability(content, skillPath, config.allowedHarnessReferences);
      errors.push(...portabilityErrors);
    }
    
    if (config.checkLinks) {
      const links = extractLinks(content);
      stats.linksChecked += links.length;
      const linkWarnings = checkLinks(links, skillPath);
      warnings.push(...linkWarnings);
    }
  }
  
  // Validate Workflows
  const workflowFiles = findFiles(workflowsDir);
  for (const file of workflowFiles) {
    stats.workflowsChecked++;
    const content = readFileSync(file, "utf-8");
    
    const requiredSections = ["## Trigger", "## Roles", "## Skill Sequence", "## Risk Adaptation"];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        warnings.push({
          category: "workflow",
          file,
          message: `Missing section '${section}'`,
          severity: "warning",
        });
      }
    }
    
    const refs = extractSkillReferences(content);
    stats.referencesChecked += refs.length;
    for (const ref of refs) {
      if (!skillNames.has(ref)) {
        warnings.push({
          category: "reference",
          file,
          message: `References unknown skill '${ref}'`,
          severity: "warning",
        });
      }
    }
    
    if (config.checkPortability) {
      const portabilityErrors = checkPortability(content, file, config.allowedHarnessReferences);
      errors.push(...portabilityErrors);
    }
    
    if (config.checkLinks) {
      const links = extractLinks(content);
      stats.linksChecked += links.length;
      const linkWarnings = checkLinks(links, file);
      warnings.push(...linkWarnings);
    }
  }
  
  // Validate Roles
  const roleFiles = findFiles(rolesDir);
  for (const file of roleFiles) {
    stats.rolesChecked++;
    const content = readFileSync(file, "utf-8");
    
    const requiredSections = ["## Mission", "## Responsibilities", "## Expected Inputs", "## Expected Outputs", "## Skill Selection Behavior", "## Collaboration", "## Evidence", "## Escalation"];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        warnings.push({
          category: "role",
          file,
          message: `Missing section '${section}'`,
          severity: "warning",
        });
      }
    }
    
    if (config.checkPortability) {
      const portabilityErrors = checkPortability(content, file, config.allowedHarnessReferences);
      errors.push(...portabilityErrors);
    }
  }
  
  const requiredRoles = ["lead.md", "builder.md", "reviewer.md"];
  const foundRoles = new Set(roleFiles.map(f => f.split("/").pop() || ""));
  for (const req of requiredRoles) {
    if (!foundRoles.has(req)) {
      errors.push({
        category: "role",
        file: join(rolesDir, req),
        message: `Missing required role: ${req}`,
        severity: "error",
      });
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}