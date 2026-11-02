/**
 * Cross-process file locking for vstack workflow state
 * Uses atomic file creation (O_CREAT | O_EXCL) for lock acquisition
 */

import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, constants } from "node:fs";
import { VstackPaths, validateVstackPath, ensureVstackDirs } from "./repository-root.js";

export interface LockOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
  maxRetries?: number;
}

export interface Lock {
  release(): void;
  isValid(): boolean;
}

export class LockError extends Error {
  constructor(
    message: string,
    public readonly code: "TIMEOUT" | "ALREADY_HELD" | "STALE_LOCK" | "IO_ERROR",
    public readonly lockPath?: string
  ) {
    super(message);
    this.name = "LockError";
  }
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_INTERVAL_MS = 50;
const LOCK_FILE_NAME = "lock";

/**
 * Acquire an exclusive lock for a specific resource
 * Returns a Lock object with release() method
 */
export async function acquireLock(
  paths: VstackPaths,
  resourceName: string,
  options: LockOptions = {}
): Promise<Lock> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retryIntervalMs = DEFAULT_RETRY_INTERVAL_MS } = options;
  
  await ensureVstackDirs(paths);
  const lockDir = validateVstackPath(paths, paths.locks);
  
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }
  
  const lockPath = validateVstackPath(paths, resolve(lockDir, `${resourceName}.${LOCK_FILE_NAME}`));
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      // O_CREAT | O_EXCL creates file only if it doesn't exist (atomic)
      const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o644);
      closeSync(fd);
      
      // Write lock metadata
      const lockMetadata = {
        pid: process.pid,
        resource: resourceName,
        acquiredAt: new Date().toISOString(),
        hostname: require("node:os").hostname(),
      };
      writeFileSync(lockPath, JSON.stringify(lockMetadata, null, 2), "utf-8");
      
      let released = false;
      return {
        release(): void {
          if (released) return;
          released = true;
          try {
            // Verify we still own the lock before releasing
            if (existsSync(lockPath)) {
              const content = readFileSync(lockPath, "utf-8");
              const metadata = JSON.parse(content);
              if (metadata.pid === process.pid) {
                unlinkSync(lockPath);
              }
            }
          } catch {
            // Ignore cleanup errors
          }
        },
        isValid(): boolean {
          if (released) return false;
          try {
            if (!existsSync(lockPath)) return false;
            const content = readFileSync(lockPath, "utf-8");
            const metadata = JSON.parse(content);
            return metadata.pid === process.pid;
          } catch {
            return false;
          }
        },
      };
    } catch (error: any) {
      if (error.code === "EEXIST") {
        // Lock held by another process, check if stale
        try {
          const content = readFileSync(lockPath, "utf-8");
          const metadata = JSON.parse(content);
          const lockAge = Date.now() - new Date(metadata.acquiredAt).getTime();
          
          // Consider lock stale if older than 5 minutes (300000ms)
          // This handles crashed processes
          if (lockAge > 300000) {
            // Attempt to remove stale lock
            try {
              unlinkSync(lockPath);
              // Continue loop to acquire
              continue;
            } catch {
              // Could not remove, wait and retry
            }
          }
        } catch {
          // Corrupted lock file, try to remove
          try { unlinkSync(lockPath); } catch {}
        }
        
        // Wait before retry with jitter
        const waitTime = retryIntervalMs + Math.random() * 20;
        const endWait = Date.now() + waitTime;
        while (Date.now() < endWait) { /* spin */ }
        continue;
      }
      
      throw new LockError(
        `Failed to acquire lock: ${error instanceof Error ? error.message : "unknown error"}`,
        "IO_ERROR",
        lockPath
      );
    }
  }
  
  throw new LockError(
    `Lock acquisition timed out after ${timeoutMs}ms for resource: ${resourceName}`,
    "TIMEOUT",
    lockPath
  );
}

/**
 * Acquire lock with automatic release (using try/finally pattern)
 */
export async function withLock<T>(
  paths: VstackPaths,
  resourceName: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const lock = await acquireLock(paths, resourceName, options);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/**
 * Check if a lock is currently held
 */
export function isLocked(paths: VstackPaths, resourceName: string): boolean {
  const lockDir = validateVstackPath(paths, paths.locks);
  const lockPath = resolve(lockDir, `${resourceName}.${LOCK_FILE_NAME}`);
  return existsSync(lockPath);
}

/**
 * Get lock metadata if held
 */
export function getLockInfo(paths: VstackPaths, resourceName: string): { pid: number; acquiredAt: string; hostname: string } | null {
  const lockDir = validateVstackPath(paths, paths.locks);
  const lockPath = resolve(lockDir, `${resourceName}.${LOCK_FILE_NAME}`);
  
  if (!existsSync(lockPath)) return null;
  
  try {
    const content = readFileSync(lockPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Force release a lock (use with caution - only for recovery)
 */
export function forceReleaseLock(paths: VstackPaths, resourceName: string): boolean {
  const lockDir = validateVstackPath(paths, paths.locks);
  const lockPath = resolve(lockDir, `${resourceName}.${LOCK_FILE_NAME}`);
  
  if (existsSync(lockPath)) {
    try {
      unlinkSync(lockPath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// Need to import path for resolve
import { resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";