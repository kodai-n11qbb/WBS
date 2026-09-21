import { describe, it, expect, vi } from 'vitest';
import { SystemBrowserLauncher } from '../../src/adapters/browser_launcher.js';

describe('SystemBrowserLauncher Adapter', () => {
  it('should generate correct open command per OS platform', () => {
    const winLauncher = new SystemBrowserLauncher({ platform: 'win32' });
    expect(winLauncher.getCommandForUrl('http://localhost:3000')).toBe('start "" "http://localhost:3000"');

    const macLauncher = new SystemBrowserLauncher({ platform: 'darwin' });
    expect(macLauncher.getCommandForUrl('http://localhost:3000')).toBe('open "http://localhost:3000"');

    const linuxLauncher = new SystemBrowserLauncher({ platform: 'linux' });
    expect(linuxLauncher.getCommandForUrl('http://localhost:3000')).toBe('xdg-open "http://localhost:3000"');
  });

  it('should execute command via execFn and resolve true on success', async () => {
    const mockExec = vi.fn((cmd: string, cb?: (err: Error | null) => void) => {
      if (cb) cb(null);
    });

    const launcher = new SystemBrowserLauncher({
      platform: 'darwin',
      execFn: mockExec,
    });

    const result = await launcher.open('http://localhost:3000');
    expect(result).toBe(true);
    expect(mockExec).toHaveBeenCalledWith('open "http://localhost:3000"', expect.any(Function));
  });

  it('should resolve false gracefully when execFn fails', async () => {
    const mockExec = vi.fn((cmd: string, cb?: (err: Error | null) => void) => {
      if (cb) cb(new Error('Command failed'));
    });

    const launcher = new SystemBrowserLauncher({
      platform: 'darwin',
      execFn: mockExec,
    });

    const result = await launcher.open('http://localhost:3000');
    expect(result).toBe(false);
  });
});
