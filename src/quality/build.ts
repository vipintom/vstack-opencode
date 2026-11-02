/**
 * Build execution and validation
 * Handles project building across different languages/frameworks
 */

import { VstackPaths } from "../persistence/repository-root.js";
import { readJsonFile, writeJsonFile } from "../persistence/file-store.js";
import { appendEvent, EventPayloads } from "../persistence/event-log.js";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";

export interface BuildConfig {
  commands: BuildCommand[];
  timeout: number;
  requiredArtifacts: string[];
  cacheDir?: string;
}

export interface BuildCommand {
  name: string;
  command: string[];
  workingDirectory: string;
  description: string;
  required: boolean;
}

export interface BuildResult {
  success: boolean;
  commandResults: CommandResult[];
  artifacts: BuildArtifact[];
  duration: number;
  startedAt: string;
  completedAt: string;
}

export interface CommandResult {
  name: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface BuildArtifact {
  path: string;
  type: "binary" | "library" | "package" | "docker" | "other";
  size: number;
  checksum?: string;
}

/**
 * Create build manager
 */
export async function createBuildManager(paths: VstackPaths) {
  return {
    /**
     * Discover build configuration from project
     */
    async discoverBuildConfig(projectRoot: string): Promise<BuildConfig> {
      const fs = await import("node:fs");
      const commands: BuildCommand[] = [];
      const requiredArtifacts: string[] = [];
      
      // Check package.json
      const packageJsonPath = resolve(projectRoot, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
        const scripts = pkg.scripts ?? {};
        
        if (scripts.build) {
          commands.push({
            name: "npm build",
            command: ["npm", "run", "build"],
            workingDirectory: projectRoot,
            description: "Build project via npm",
            required: true,
          });
          
          // Infer artifacts from build output or package config
          if (pkg.files) {
            requiredArtifacts.push(...pkg.files);
          }
        }
        
        // Check for other build scripts
        if (scripts.compile) {
          commands.push({
            name: "npm compile",
            command: ["npm", "run", "compile"],
            workingDirectory: projectRoot,
            description: "Compile TypeScript",
            required: false,
          });
        }
      }
      
      // Check for Makefile
      if (fs.existsSync(resolve(projectRoot, "Makefile"))) {
        commands.push({
          name: "make",
          command: ["make"],
          workingDirectory: projectRoot,
          description: "Build via Makefile",
          required: commands.length === 0,
        });
      }
      
      // Check for Cargo.toml (Rust)
      if (fs.existsSync(resolve(projectRoot, "Cargo.toml"))) {
        commands.push({
          name: "cargo build",
          command: ["cargo", "build", "--release"],
          workingDirectory: projectRoot,
          description: "Build Rust project",
          required: commands.length === 0,
        });
      }
      
      // Check for go.mod (Go)
      if (fs.existsSync(resolve(projectRoot, "go.mod"))) {
        commands.push({
          name: "go build",
          command: ["go", "build", "./..."],
          workingDirectory: projectRoot,
          description: "Build Go project",
          required: commands.length === 0,
        });
      }
      
      // Check for pyproject.toml (Python)
      if (fs.existsSync(resolve(projectRoot, "pyproject.toml"))) {
        commands.push({
          name: "python build",
          command: ["python", "-m", "build"],
          workingDirectory: projectRoot,
          description: "Build Python package",
          required: commands.length === 0,
        });
      }
      
      return {
        commands,
        timeout: 300000, // 5 minutes
        requiredArtifacts,
      };
    },
    
    /**
     * Execute build
     */
    async executeBuild(
      config: BuildConfig,
      deliveryId: string,
      taskId: string | null,
      phaseRunId: string | null,
      commitRef: string
    ): Promise<BuildResult> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      
      const commandResults: CommandResult[] = [];
      const artifacts: BuildArtifact[] = [];
      
      for (const cmd of config.commands) {
        const cmdStarted = Date.now();
        
        const result = await executeCommand(cmd.command, {
          cwd: cmd.workingDirectory,
          timeout: config.timeout,
          env: { ...process.env, CI: "true" },
        });
        
        const duration = Date.now() - cmdStarted;
        
        commandResults.push({
          name: cmd.name,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration,
        });
        
        if (result.exitCode !== 0 && cmd.required) {
          // Required command failed
          return {
            success: false,
            commandResults,
            artifacts,
            duration: Date.now() - startedMs,
            startedAt,
            completedAt: new Date().toISOString(),
          };
        }
      }
      
      // Find artifacts
      for (const artifactPattern of config.requiredArtifacts) {
        const found = await findArtifacts(config.commands[0]?.workingDirectory || ".", artifactPattern);
        artifacts.push(...found);
      }
      
      const completedAt = new Date().toISOString();
      const success = commandResults.every(r => r.exitCode === 0);
      
      return {
        success,
        commandResults,
        artifacts,
        duration: Date.now() - startedMs,
        startedAt,
        completedAt,
      };
    },
    
    /**
     * Validate build artifacts
     */
    async validateArtifacts(artifacts: BuildArtifact[]): Promise<{ valid: boolean; errors: string[] }> {
      const errors: string[] = [];
      const fs = await import("node:fs");
      
      for (const artifact of artifacts) {
        if (!fs.existsSync(artifact.path)) {
          errors.push(`Artifact not found: ${artifact.path}`);
        } else {
          const stats = fs.statSync(artifact.path);
          if (stats.size !== artifact.size) {
            errors.push(`Artifact size mismatch: ${artifact.path} (expected ${artifact.size}, got ${stats.size})`);
          }
        }
      }
      
      return { valid: errors.length === 0, errors };
    },
  };
}

/**
 * Execute command
 */
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

/**
 * Find artifacts matching pattern
 */
async function findArtifacts(rootDir: string, pattern: string): Promise<BuildArtifact[]> {
  const { glob } = await import("glob");
  
  const artifacts: BuildArtifact[] = [];
  
  try {
    const matches = await glob(pattern, { cwd: rootDir, absolute: true });
    
    for (const match of matches) {
      const stats = statSync(match);
      artifacts.push({
        path: match,
        type: inferArtifactType(match),
        size: stats.size,
      });
    }
  } catch (error) {
    console.warn(`Failed to find artifacts for pattern ${pattern}:`, error);
  }
  
  return artifacts;
}

/**
 * Infer artifact type from path
 */
function inferArtifactType(path: string): BuildArtifact["type"] {
  if (path.endsWith(".docker") || path.includes("Dockerfile")) return "docker";
  if (path.endsWith(".tar.gz") || path.endsWith(".tgz") || path.endsWith(".zip")) return "package";
  if (path.endsWith(".so") || path.endsWith(".dylib") || path.endsWith(".dll") || path.endsWith(".a")) return "library";
  if (statSync(path).isFile() && !path.includes(".")) return "binary";
  return "other";
}