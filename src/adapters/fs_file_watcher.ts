import fs from 'node:fs';
import { FileWatcherPort } from '../ports/watcher.js';

/**
 * File System Watcher Adapter utilizing Node.js fs.watch with debounce protection.
 * Adheres to DEV_POLICY_v1.0518.md (Dependency Injection, Rule of Three).
 */
export class FsFileWatcherAdapter implements FileWatcherPort {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;

  constructor(debounceMs: number = 150) {
    this.debounceMs = debounceMs;
  }

  public startWatching(targetPath: string, onChange: (eventPath: string) => void): void {
    this.stopWatching();

    if (!fs.existsSync(targetPath)) {
      return;
    }

    try {
      this.watcher = fs.watch(targetPath, (eventType, filename) => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          const changedPath = filename ? filename : targetPath;
          onChange(changedPath);
        }, this.debounceMs);
      });
    } catch (err) {
      console.warn(`[FsFileWatcherAdapter] Failed to start fs.watch for ${targetPath}:`, err);
    }
  }

  public stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {}
      this.watcher = null;
    }
  }
}
