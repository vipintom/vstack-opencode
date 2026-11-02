/**
 * File store for vstack workflow state
 * Provides atomic writes, locking, schema validation, and revision-based optimistic concurrency
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  openSync,
  closeSync,
  unlinkSync,
  statSync,
  constants,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { VstackPaths, validateVstackPath, ensureVstackDirs } from "./repository-root.js";
import { Ajv } from "ajv";
const ajv = new Ajv({ allErrors: true, strict: false });

export interface WriteOptions {
  expectedRevision?: number;
}

export interface ReadOptions {
  validateSchema?: boolean;
}

export class FileStoreError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "PARSE_ERROR" | "REVISION_CONFLICT" | "PATH_TRAVERSAL" | "LOCK_FAILED" | "IO_ERROR" | "SCHEMA_VALIDATION_ERROR",
    public readonly path?: string
  ) {
    super(message);
    this.name = "FileStoreError";
  }
}

let schemaCache: Map<string, Record<string, unknown>> = new Map();
let compiledValidators: Map<string, any> = new Map();

export async function loadSchema(schemaPath: string): Promise<Record<string, unknown>> {
  if (schemaCache.has(schemaPath)) {
    return schemaCache.get(schemaPath)!;
  }
  
  const fs = await import("node:fs");
  const content = fs.readFileSync(schemaPath, "utf-8");
  const schema = JSON.parse(content);
  schemaCache.set(schemaPath, schema);
  return schema;
}

export async function getValidator(schemaPath: string) {
  if (compiledValidators.has(schemaPath)) {
    return compiledValidators.get(schemaPath)!;
  }
  const schema = await loadSchema(schemaPath);
  const validator = ajv.compile(schema);
  compiledValidators.set(schemaPath, validator);
  return validator;
}

export async function validateAgainstSchema(data: unknown, schemaPath: string): Promise<{ valid: boolean; errors: string[] }> {
  const validator = await getValidator(schemaPath);
  const valid = validator(data);
  return { 
    valid: !!valid, 
    errors: validator.errors?.map((e: any) => `${e.instancePath} ${e.message}`) || [] 
  };
}

/**
 * Read a JSON file with optional schema validation
 */
export async function readJsonFile<T>(
  paths: VstackPaths,
  filePath: string,
  schemaPath?: string,
  options: ReadOptions = {}
): Promise<T | null> {
  const validatedPath = validateVstackPath(paths, filePath);
  
  if (!existsSync(validatedPath)) {
    return null;
  }
  
  try {
    const content = readFileSync(validatedPath, "utf-8");
    const data = JSON.parse(content) as T;
    
    if (options.validateSchema && schemaPath) {
      const validation = await validateAgainstSchema(data, schemaPath);
      if (!validation.valid) {
        throw new FileStoreError(
          `Schema validation failed for ${filePath}: ${validation.errors.join(", ")}`,
          "SCHEMA_VALIDATION_ERROR",
          validatedPath
        );
      }
    }
    
    return data;
  } catch (error) {
    if (error instanceof FileStoreError) throw error;
    if (error instanceof SyntaxError) {
      throw new FileStoreError(
        `Failed to parse JSON: ${error.message}`,
        "PARSE_ERROR",
        validatedPath
      );
    }
    throw new FileStoreError(
      `Failed to read file: ${error instanceof Error ? error.message : "unknown error"}`,
      "IO_ERROR",
      validatedPath
    );
  }
}

/**
 * Write a JSON file atomically with optional revision check
 */
export async function writeJsonFile<T extends { revision?: number }>(
  paths: VstackPaths,
  filePath: string,
  data: T,
  schemaPath?: string,
  options: WriteOptions = {}
): Promise<void> {
  const validatedPath = validateVstackPath(paths, filePath);
  await ensureVstackDirs(paths);
  
  // Validate schema if requested
  if (schemaPath) {
    const validation = await validateAgainstSchema(data, schemaPath);
    if (!validation.valid) {
      throw new FileStoreError(
        `Schema validation failed for ${filePath}: ${validation.errors.join(", ")}`,
        "SCHEMA_VALIDATION_ERROR",
        validatedPath
      );
    }
  }
  
  // Revision check (optimistic concurrency)
  if (options.expectedRevision !== undefined && data.revision !== undefined) {
    const currentData = await readJsonFile(paths, filePath);
    if (currentData && typeof currentData === "object" && "revision" in currentData) {
      const currentRevision = (currentData as { revision: number }).revision;
      if (currentRevision !== options.expectedRevision) {
        throw new FileStoreError(
          `Revision conflict: expected ${options.expectedRevision}, current is ${currentRevision}`,
          "REVISION_CONFLICT",
          validatedPath
        );
      }
    }
  }
  
  // Atomic write via temp file + rename
  const tempPath = `${validatedPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tempPath, validatedPath);
  } catch (error) {
    // Cleanup temp file on error
    try { unlinkSync(tempPath); } catch {}
    throw new FileStoreError(
      `Failed to write file: ${error instanceof Error ? error.message : "unknown error"}`,
      "IO_ERROR",
      validatedPath
    );
  }
}

/**
 * Delete a file
 */
export function deleteFile(paths: VstackPaths, filePath: string): void {
  const validatedPath = validateVstackPath(paths, filePath);
  if (existsSync(validatedPath)) {
    unlinkSync(validatedPath);
  }
}

/**
 * List files in a directory
 */
export function listFiles(paths: VstackPaths, dirPath: string, extension = ".json"): string[] {
  const validatedPath = validateVstackPath(paths, dirPath);
  if (!existsSync(validatedPath)) {
    return [];
  }
  try {
    return readdirSync(validatedPath)
      .filter(name => name.endsWith(extension))
      .map(name => name.slice(0, -extension.length));
  } catch {
    return [];
  }
}

/**
 * List directories in a directory
 */
export function listDirs(paths: VstackPaths, dirPath: string): string[] {
  const validatedPath = validateVstackPath(paths, dirPath);
  if (!existsSync(validatedPath)) {
    return [];
  }
  try {
    return readdirSync(validatedPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  } catch {
    return [];
  }
}

/**
 * Read a file as raw string
 */
export function readFile(paths: VstackPaths, filePath: string): string | null {
  const validatedPath = validateVstackPath(paths, filePath);
  if (!existsSync(validatedPath)) {
    return null;
  }
  return readFileSync(validatedPath, "utf-8");
}

/**
 * Write a file as raw string atomically
 */
export async function writeFile(paths: VstackPaths, filePath: string, content: string): Promise<void> {
  const validatedPath = validateVstackPath(paths, filePath);
  await ensureVstackDirs(paths);
  
  const tempPath = `${validatedPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tempPath, content, "utf-8");
    renameSync(tempPath, validatedPath);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw new FileStoreError(
      `Failed to write file: ${error instanceof Error ? error.message : "unknown error"}`,
      "IO_ERROR",
      validatedPath
    );
  }
}

/**
 * Check if file exists
 */
export function fileExists(paths: VstackPaths, filePath: string): boolean {
  const validatedPath = validateVstackPath(paths, filePath);
  return existsSync(validatedPath);
}

/**
 * Get file stats (mtime, size)
 */
export function getFileStats(paths: VstackPaths, filePath: string): { mtime: Date; size: number } | null {
  const validatedPath = validateVstackPath(paths, filePath);
  if (!existsSync(validatedPath)) {
    return null;
  }
  const stats = statSync(validatedPath);
  return { mtime: stats.mtime, size: stats.size };
}