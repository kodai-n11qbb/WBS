import { exec } from 'node:child_process';
import { BrowserLauncherPort } from '../ports/browser_launcher.js';

export interface SystemBrowserLauncherOptions {
  execFn?: (command: string, callback?: (error: Error | null) => void) => void;
  platform?: NodeJS.Platform;
}

export class SystemBrowserLauncher implements BrowserLauncherPort {
  private execFn: (command: string, callback?: (error: Error | null) => void) => void;
  private platform: NodeJS.Platform;

  constructor(options: SystemBrowserLauncherOptions = {}) {
    this.execFn = options.execFn || exec;
    this.platform = options.platform || process.platform;
  }

  getCommandForUrl(url: string): string {
    switch (this.platform) {
      case 'win32':
        return `start "" "${url}"`;
      case 'darwin':
        return `open "${url}"`;
      default:
        return `xdg-open "${url}"`;
    }
  }

  open(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const command = this.getCommandForUrl(url);
      this.execFn(command, (error) => {
        if (error) {
          console.warn(`[BrowserLauncher] Failed to auto-open browser: ${error.message}`);
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }
}
