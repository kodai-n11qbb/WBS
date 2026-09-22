import fs from 'node:fs';
import path from 'node:path';
import { AppConfig, ConfigPort, OperatingMode } from '../ports/config.js';
import { crypto } from '../core/crypto_util.js';

export class JsonConfigAdapter implements ConfigPort {
  private configPath: string;
  private cliArgs: string[];

  constructor(configPath?: string, cliArgs?: string[]) {
    this.configPath = configPath || path.join(process.cwd(), 'config.json');
    this.cliArgs = cliArgs || process.argv.slice(2);
  }

  public async loadConfig(): Promise<AppConfig> {
    const defaultConfig: AppConfig = {
      mode: 'P2P',
      dataPath: path.join(process.cwd(), 'data', 'state.json'),
      port: 3000,
      nodeName: `node-${crypto.randomUUID().slice(0, 6)}`,
      autoOpen: true,
      udpPort: 41234,
    };

    let fileConfig: Partial<AppConfig> = {};
    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        fileConfig = JSON.parse(raw);
      } catch (err) {
        console.warn(`[ConfigAdapter] Failed to parse ${this.configPath}, falling back to defaults:`, err);
      }
    }

    const merged: AppConfig = {
      ...defaultConfig,
      ...fileConfig,
    };

    // Override with CLI Arguments if provided
    const cliConfig = this.parseCliArgs(this.cliArgs);
    const finalConfig: AppConfig = {
      ...merged,
      ...cliConfig,
    };

    return finalConfig;
  }

  public async saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
    const current = await this.loadConfig();
    const updated: AppConfig = {
      ...current,
      ...config,
    };

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.configPath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  private parseCliArgs(args: string[]): Partial<AppConfig> {
    const parsed: Partial<AppConfig> = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--mode' && args[i + 1]) {
        const m = args[i + 1].toUpperCase() as OperatingMode;
        if (m === 'P2P' || m === 'CLIENT' || m === 'HOST') {
          parsed.mode = m;
        }
        i++;
      } else if (arg.startsWith('--mode=')) {
        const m = arg.split('=')[1].toUpperCase() as OperatingMode;
        if (m === 'P2P' || m === 'CLIENT' || m === 'HOST') {
          parsed.mode = m;
        }
      } else if ((arg === '--port' || arg === '-p') && args[i + 1]) {
        parsed.port = parseInt(args[i + 1], 10);
        i++;
      } else if (arg.startsWith('--port=')) {
        parsed.port = parseInt(arg.split('=')[1], 10);
      } else if ((arg === '--host-address' || arg === '--host') && args[i + 1]) {
        parsed.hostAddress = args[i + 1];
        i++;
      } else if (arg.startsWith('--host-address=') || arg.startsWith('--host=')) {
        parsed.hostAddress = arg.split('=')[1];
      } else if (arg === '--data-path' && args[i + 1]) {
        parsed.dataPath = args[i + 1];
        i++;
      } else if (arg.startsWith('--data-path=')) {
        parsed.dataPath = arg.split('=')[1];
      } else if (arg === '--no-auto-open' || arg === '--auto-open=false') {
        parsed.autoOpen = false;
      }
    }

    return parsed;
  }
}
