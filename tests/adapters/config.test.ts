import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JsonConfigAdapter } from '../../src/adapters/config.js';

describe('JsonConfigAdapter', () => {
  const testDir = path.join(process.cwd(), 'temp_test_config');
  const configPath = path.join(testDir, 'config.json');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should load default config when config.json does not exist with absolute path', async () => {
    const adapter = new JsonConfigAdapter(configPath, []);
    const config = await adapter.loadConfig();

    expect(config.mode).toBe('P2P');
    expect(config.port).toBe(3000);
    expect(config.dataDir).toContain('data');
    expect(path.isAbsolute(config.dataDir)).toBe(true);
    expect(config.autoOpen).toBe(true);
  });

  it('should save and reload config with absolute dataDir path', async () => {
    const adapter = new JsonConfigAdapter(configPath, []);
    await adapter.saveConfig({
      mode: 'HOST',
      port: 8080,
      dataDir: './custom/data',
    });

    const reloaded = await adapter.loadConfig();
    expect(reloaded.mode).toBe('HOST');
    expect(reloaded.port).toBe(8080);
    expect(reloaded.dataDir).toContain(path.normalize('custom/data'));
    expect(path.isAbsolute(reloaded.dataDir)).toBe(true);
  });

  it('should override config with CLI arguments including --data-dir resolved to absolute path', async () => {
    const cliArgs = ['--mode', 'CLIENT', '--host', '192.168.1.100:4000', '--port', '9090', '--data-dir', './cli_data', '--no-auto-open'];
    const adapter = new JsonConfigAdapter(configPath, cliArgs);
    const config = await adapter.loadConfig();

    expect(config.mode).toBe('CLIENT');
    expect(config.hostAddress).toBe('192.168.1.100:4000');
    expect(config.port).toBe(9090);
    expect(config.dataDir).toContain('cli_data');
    expect(path.isAbsolute(config.dataDir)).toBe(true);
    expect(config.autoOpen).toBe(false);
  });

  it('should fallback legacy dataPath to dataDir directory as absolute path', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ mode: 'P2P', port: 3000, dataPath: './legacy/state.json' }));
    const adapter = new JsonConfigAdapter(configPath, []);
    const config = await adapter.loadConfig();

    expect(config.dataDir).toContain('legacy');
    expect(path.isAbsolute(config.dataDir)).toBe(true);
  });
});
