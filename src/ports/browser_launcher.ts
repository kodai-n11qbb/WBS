export interface BrowserLauncherPort {
  open(url: string): Promise<boolean>;
}
