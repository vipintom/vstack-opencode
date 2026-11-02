/**
 * Schema version management for vstack workflow state
 * Handles migrations and version validation
 */

import { VstackPaths } from "./repository-root.js";
import { readJsonFile, writeJsonFile, FileStoreError } from "./file-store.js";

export const CURRENT_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = [1];

export interface SchemaVersionInfo {
  version: number;
  migratedAt: string;
  fromVersion: number | null;
}

export class SchemaVersionError extends Error {
  constructor(
    message: string,
    public readonly code: "UNSUPPORTED_VERSION" | "MIGRATION_FAILED" | "VERSION_MISMATCH",
    public readonly path?: string
  ) {
    super(message);
    this.name = "SchemaVersionError";
  }
}

/**
 * Check if a schema version is supported
 */
export function isSupportedSchemaVersion(version: number): boolean {
  return SUPPORTED_SCHEMA_VERSIONS.includes(version);
}

/**
 * Validate schema version in a file
 */
export async function validateSchemaVersion(
  paths: VstackPaths,
  filePath: string,
  expectedVersion = CURRENT_SCHEMA_VERSION
): Promise<void> {
  const validatedPath = validateVstackPath(paths, filePath);
  
  const fs = await import("node:fs");
  if (!fs.existsSync(validatedPath)) {
    throw new FileStoreError(`File not found: ${filePath}`, "NOT_FOUND", validatedPath);
  }
  
  const content = fs.readFileSync(validatedPath, "utf-8");
  const data = JSON.parse(content);
  
  if (!data.schemaVersion) {
    throw new SchemaVersionError(
      `Missing schemaVersion in ${filePath}`,
      "VERSION_MISMATCH",
      validatedPath
    );
  }
  
  if (data.schemaVersion !== expectedVersion) {
    throw new SchemaVersionError(
      `Schema version mismatch in ${filePath}: expected ${expectedVersion}, found ${data.schemaVersion}`,
      "VERSION_MISMATCH",
      validatedPath
    );
  }
  
  if (!isSupportedSchemaVersion(data.schemaVersion)) {
    throw new SchemaVersionError(
      `Unsupported schema version ${data.schemaVersion} in ${filePath}`,
      "UNSUPPORTED_VERSION",
      validatedPath
    );
  }
}

/**
 * Migrate a file from old schema version to current
 * Returns true if migration was performed
 */
export async function migrateFileIfNeeded(
  paths: VstackPaths,
  filePath: string,
  migrators: Map<number, (data: unknown) => unknown>
): Promise<boolean> {
  const validatedPath = validateVstackPath(paths, filePath);
  
  const fs = await import("node:fs");
  if (!fs.existsSync(validatedPath)) {
    return false;
  }
  
  const content = fs.readFileSync(validatedPath, "utf-8");
  const data = JSON.parse(content);
  
  if (!data.schemaVersion) {
    // No schema version - assume v1
    return false;
  }
  
  if (data.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return false; // Already current
  }
  
  if (data.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(
      `File has newer schema version (${data.schemaVersion}) than supported (${CURRENT_SCHEMA_VERSION})`,
      "UNSUPPORTED_VERSION",
      validatedPath
    );
  }
  
  // Apply migrations sequentially
  let migratedData = data;
  for (let v = data.schemaVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const migrator = migrators.get(v);
    if (!migrator) {
      throw new SchemaVersionError(
        `No migrator found for version ${v}`,
        "MIGRATION_FAILED",
        validatedPath
      );
    }
    migratedData = migrator(migratedData);
  }
  
  // Update schema version
  migratedData = { ...migratedData, schemaVersion: CURRENT_SCHEMA_VERSION };
  
  // Write back
  await writeJsonFile(paths, validatedPath, migratedData);
  
  return true;
}

/**
 * Create a schema version migration record
 */
export function createMigrationRecord(fromVersion: number | null): SchemaVersionInfo {
  return {
    version: CURRENT_SCHEMA_VERSION,
    migratedAt: new Date().toISOString(),
    fromVersion,
  };
}

// Need to import validateVstackPath
import { validateVstackPath } from "./repository-root.js";