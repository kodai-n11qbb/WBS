export type OperatingMode = 'P2P' | 'CLIENT' | 'HOST';

export interface AppConfig {
  mode: OperatingMode;
  dataPath: string;        // Path to data/state.json or state snapshot file
  hostAddress?: string;    // Remote host terminal address (e.g. "192.168.1.50:3000") for CLIENT mode
  port: number;            // Web UI port (default 3000)
  nodeName: string;        // Node display name
  autoOpen: boolean;       // Automatically open browser on startup
  udpPort: number;         // UDP discovery port for P2P mode (default 41234)
}

export interface ConfigPort {
  loadConfig(): Promise<AppConfig>;
  saveConfig(config: Partial<AppConfig>): Promise<AppConfig>;
}
