import fs from 'node:fs';
import path from 'node:path';
import { AppConfig, ConfigPort, OperatingMode } from '../ports/config.js';
import { crypto } from '../core/crypto_util.js';

export class JsonConfigAdapter implements ConfigPort {
  private configPath: string;
  private cliArgs: string[];
  private execDirOverride?: string;

  constructor(configPath?: string, cliArgs?: string[], execDir?: string) {
    this.execDirOverride = execDir;
    this.configPath = configPath || this.resolveConfigPath();
    this.cliArgs = cliArgs || process.argv.slice(2);
  }

  private getExecDir(): string {
    return this.execDirOverride || path.dirname(process.execPath);
  }

  private resolveConfigPath(): string {
    const isPkg = (process as any).pkg !== undefined;
    const execDir = this.getExecDir();

    // In packaged binary mode, look strictly in execDir first
    const candidates = isPkg
      ? [path.join(execDir, 'config.json')]
      : [path.join(process.cwd(), 'config.json'), path.join(execDir, 'config.json')];

    for (const cand of candidates) {
      try {
        if (fs.existsSync(cand)) {
          return cand;
        }
      } catch {}
    }

    return isPkg ? path.join(execDir, 'config.json') : path.join(process.cwd(), 'config.json');
  }

  public async loadConfig(): Promise<AppConfig> {
    const isPkg = (process as any).pkg !== undefined;
    const execDir = this.getExecDir();

    // Default data directory: './WBS_data' for both dev and binary
    const initialDataDir = isPkg
      ? path.resolve(execDir, 'WBS_data')
      : path.resolve(process.cwd(), 'WBS_data');

    const defaultConfig: AppConfig = {
      mode: 'P2P',
      dataDir: initialDataDir,
      port: 3000,
      nodeName: `node-${crypto.randomUUID().slice(0, 6)}`,
      autoOpen: true,
      udpPort: 41234,
    };

    let fileConfig: Partial<AppConfig> & { dataPath?: string } = {};
    if (fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        fileConfig = JSON.parse(raw);
      } catch (err) {
        console.warn(`[ConfigAdapter] Failed to parse ${this.configPath}, falling back to defaults:`, err);
      }
    }

    // Handle legacy dataPath if present in fileConfig
    if (fileConfig.dataPath && !fileConfig.dataDir) {
      if (fileConfig.dataPath.endsWith('.json') || fileConfig.dataPath.endsWith('.jsonl')) {
        fileConfig.dataDir = path.dirname(fileConfig.dataPath);
      } else {
        fileConfig.dataDir = fileConfig.dataPath;
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

    // Ensure dataDir is resolved relative to the config file or binary location
    if (finalConfig.dataDir && !path.isAbsolute(finalConfig.dataDir)) {
      let baseDir = isPkg ? execDir : process.cwd();
      if (fs.existsSync(this.configPath)) {
        const dir = path.dirname(this.configPath);
        if (!dir.startsWith('/snapshot')) {
          baseDir = dir;
        }
      }
      finalConfig.dataDir = path.resolve(baseDir, finalConfig.dataDir);
    }

    // Ensure data directory exists
    try {
      if (finalConfig.dataDir && !fs.existsSync(finalConfig.dataDir)) {
        fs.mkdirSync(finalConfig.dataDir, { recursive: true });
      }
    } catch {}

    return finalConfig;
  }

  public async saveConfig(config: Partial<AppConfig>): Promise<AppConfig> {
    const current = await this.loadConfig();
    // Keep dataDir as relative path (e.g. './WBS_data')
    const rawDataDir = config.dataDir;
    let dataDir = rawDataDir || './WBS_data';

    const updated: AppConfig = {
      ...current,
      ...config,
      dataDir,
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
      } else if ((arg === '--data-dir' || arg === '--data-path' || arg === '--data') && args[i + 1]) {
        const rawPath = args[i + 1];
        parsed.dataDir = (rawPath.endsWith('.json') || rawPath.endsWith('.jsonl')) ? path.dirname(rawPath) : rawPath;
        i++;
      } else if (arg.startsWith('--data-dir=') || arg.startsWith('--data-path=') || arg.startsWith('--data=')) {
        const rawPath = arg.split('=')[1];
        parsed.dataDir = (rawPath.endsWith('.json') || rawPath.endsWith('.jsonl')) ? path.dirname(rawPath) : rawPath;
      } else if (arg === '--no-auto-open' || arg === '--auto-open=false') {
        parsed.autoOpen = false;
      } else if ((arg === '--spreadsheet-url' || arg === '--sheets-url') && args[i + 1]) {
        parsed.spreadsheetWebhookUrl = args[i + 1];
        i++;
      } else if (arg.startsWith('--spreadsheet-url=') || arg.startsWith('--sheets-url=')) {
        parsed.spreadsheetWebhookUrl = arg.split('=')[1];
      }
    }

    return parsed;
  }
}
