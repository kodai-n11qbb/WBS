import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FsFileWatcherAdapter } from '../../src/adapters/fs_file_watcher.js';

describe('FsFileWatcherAdapter', () => {
  const testDir = path.join(__dirname, '../temp_watcher_test');
  const filePath = path.join(testDir, 'watch_file.txt');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    fs.writeFileSync(filePath, 'initial', 'utf-8');
  });

  afterEach(() => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
  });

  it('should trigger callback when monitored file is modified', async () => {
    const watcher = new FsFileWatcherAdapter(50); // fast 50ms debounce for unit test

    let triggered = false;
    let modifiedPath = '';

    watcher.startWatching(filePath, (changedPath) => {
      triggered = true;
      modifiedPath = changedPath;
    });

    // Write to file
    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(filePath, 'updated content', 'utf-8');

    // Wait for debounce timer
    await new Promise((r) => setTimeout(r, 150));

    expect(triggered).toBe(true);

    watcher.stopWatching();
  });
});
