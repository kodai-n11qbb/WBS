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

  it('should load default config when config.json does not exist', async () => {
    const adapter = new JsonConfigAdapter(configPath, []);
    const config = await adapter.loadConfig();

    expect(config.mode).toBe('P2P');
    expect(config.port).toBe(3000);
    expect(config.dataPath).toContain('state.json');
    expect(config.autoOpen).toBe(true);
  });

  it('should save and reload config from file', async () => {
    const adapter = new JsonConfigAdapter(configPath, []);
    await adapter.saveConfig({
      mode: 'HOST',
      port: 8080,
      dataPath: './custom/state.json',
    });

    const reloaded = await adapter.loadConfig();
    expect(reloaded.mode).toBe('HOST');
    expect(reloaded.port).toBe(8080);
    expect(reloaded.dataPath).toBe('./custom/state.json');
  });

  it('should override config with CLI arguments', async () => {
    const cliArgs = ['--mode', 'CLIENT', '--host', '192.168.1.100:4000', '--port', '9090', '--no-auto-open'];
    const adapter = new JsonConfigAdapter(configPath, cliArgs);
    const config = await adapter.loadConfig();

    expect(config.mode).toBe('CLIENT');
    expect(config.hostAddress).toBe('192.168.1.100:4000');
    expect(config.port).toBe(9090);
    expect(config.autoOpen).toBe(false);
  });
});
