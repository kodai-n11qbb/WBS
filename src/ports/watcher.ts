/**
 * Port interface for monitoring external file system changes.
 * Complies with Hexagonal Architecture & DEV_POLICY_v1.0518.md (DI & Rule of Three).
 */
export interface FileWatcherPort {
  /**
   * Start watching a target path (file or directory) for external changes.
   * @param targetPath Absolute path of file or directory to watch
   * @param onChange Callback fired when an external file modification occurs
   */
  startWatching(targetPath: string, onChange: (eventPath: string) => void): void;

  /**
   * Stop watching and release file system handle resources.
   */
  stopWatching(): void;
}
